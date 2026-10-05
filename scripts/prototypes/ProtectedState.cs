// Isolated Windows/NTFS research adapter. No application or network entrypoint.
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;

namespace CineVaultPrototype {
    public static class ProtectedState {
        const uint Read = 0x80000000, Write = 0x40000000, ReadControl = 0x00020000;
        const uint OpenExisting = 3, OpenAlways = 4, CreateNew = 1;
        const uint Reparse = 0x400, DirectoryFlag = 0x10;
        const uint OpenReparsePoint = 0x00200000, BackupSemantics = 0x02000000, WriteThrough = 0x80000000;
        const int Limit = 16384;
        [StructLayout(LayoutKind.Sequential)] struct Info {
            public uint Attributes;
            public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, WriteTime;
            public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
        }
        [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes {
            public int Length; public IntPtr Descriptor; public int Inherit;
        }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern SafeFileHandle CreateFile(string path, uint access, uint share,
            IntPtr security, uint disposition, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool GetFileInformationByHandle(SafeFileHandle handle, out Info info);
        static Exception Fail() { return new IOException("credential_store_recovery_required"); }
        static Info Inspect(SafeFileHandle handle, bool directory) {
            Info info;
            if (handle.IsInvalid || !GetFileInformationByHandle(handle, out info) ||
                (info.Attributes & Reparse) != 0 || ((info.Attributes & DirectoryFlag) != 0) != directory ||
                (!directory && info.Links != 1)) throw Fail();
            return info;
        }
        static void AssertAcl(string path, bool directory, SecurityIdentifier owner) {
            FileSystemSecurity acl = directory ? (FileSystemSecurity)System.IO.Directory.GetAccessControl(path)
                : (FileSystemSecurity)File.GetAccessControl(path);
            if (!acl.AreAccessRulesProtected || !owner.Equals(acl.GetOwner(typeof(SecurityIdentifier)))) throw Fail();
            HashSet<string> allowed = new HashSet<string>(StringComparer.Ordinal);
            allowed.Add(owner.Value); allowed.Add("S-1-5-18");
            HashSet<string> seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (FileSystemAccessRule rule in acl.GetAccessRules(true, true, typeof(SecurityIdentifier))) {
                if (rule.IsInherited || rule.AccessControlType != AccessControlType.Allow ||
                    !allowed.Contains(rule.IdentityReference.Value) || rule.FileSystemRights != FileSystemRights.FullControl ||
                    rule.PropagationFlags != PropagationFlags.None || rule.InheritanceFlags !=
                    (directory ? InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit : InheritanceFlags.None))
                    throw Fail();
                seen.Add(rule.IdentityReference.Value);
            }
            if (!seen.SetEquals(allowed)) throw Fail();
        }
        static DirectorySecurity DirectoryAcl(SecurityIdentifier owner) {
            DirectorySecurity acl = new DirectorySecurity(); acl.SetOwner(owner); acl.SetAccessRuleProtection(true, false);
            foreach (SecurityIdentifier sid in new SecurityIdentifier[] { owner, new SecurityIdentifier("S-1-5-18") }) {
                acl.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl,
                    InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                    PropagationFlags.None, AccessControlType.Allow));
            }
            return acl;
        }
        static FileSecurity FileAcl(SecurityIdentifier owner) {
            FileSecurity acl = new FileSecurity(); acl.SetOwner(owner); acl.SetAccessRuleProtection(true, false);
            foreach (SecurityIdentifier sid in new SecurityIdentifier[] { owner, new SecurityIdentifier("S-1-5-18") })
                acl.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl, AccessControlType.Allow));
            return acl;
        }
        static SafeFileHandle OpenFile(string path, uint disposition, uint access, SecurityIdentifier owner) {
            byte[] bytes = FileAcl(owner).GetSecurityDescriptorBinaryForm();
            IntPtr descriptor = Marshal.AllocHGlobal(bytes.Length), attributes = IntPtr.Zero;
            try {
                Marshal.Copy(bytes, 0, descriptor, bytes.Length);
                SecurityAttributes sa = new SecurityAttributes(); sa.Length = Marshal.SizeOf(typeof(SecurityAttributes));
                sa.Descriptor = descriptor; sa.Inherit = 0;
                attributes = Marshal.AllocHGlobal(sa.Length); Marshal.StructureToPtr(sa, attributes, false);
                SafeFileHandle handle = CreateFile(path, access | ReadControl, 0, attributes, disposition,
                    OpenReparsePoint | WriteThrough, IntPtr.Zero);
                if (handle.IsInvalid) { handle.Dispose(); throw Fail(); }
                try { Inspect(handle, false); AssertAcl(path, false, owner); }
                catch { handle.Dispose(); throw; }
                return handle;
            } finally { if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes); Marshal.FreeHGlobal(descriptor); }
        }
        static string Hash(byte[] bytes) {
            using (SHA256 sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
        }
        static string Current(string path, SecurityIdentifier owner, out string revision) {
            revision = null;
            if (!File.Exists(path) && !System.IO.Directory.Exists(path)) return null;
            using (SafeFileHandle handle = OpenFile(path, OpenExisting, Read, owner))
            using (FileStream file = new FileStream(handle, FileAccess.Read)) {
                if (file.Length < 1 || file.Length > Limit) throw Fail();
                byte[] bytes = new byte[(int)file.Length]; int offset = 0;
                while (offset < bytes.Length) { int n = file.Read(bytes, offset, bytes.Length - offset); if (n == 0) throw Fail(); offset += n; }
                revision = Hash(bytes); return new UTF8Encoding(false, true).GetString(bytes);
            }
        }
        // Pin every existing ancestor without DELETE sharing, then the protected leaf.
        // Reparse flags are checked on actual handles, not only path string checks.
        static SafeFileHandle Pin(string path) {
            SafeFileHandle handle = CreateFile(path, ReadControl, 3, IntPtr.Zero, OpenExisting,
                BackupSemantics | OpenReparsePoint, IntPtr.Zero);
            try { Inspect(handle, true); return handle; } catch { handle.Dispose(); throw; }
        }
        public static Dictionary<string, object> Run(string directory, string action, string payload, string expectedRevision) {
            return Run(directory, action, payload, expectedRevision, null);
        }
        // Fault checkpoint is available only to the disposable native test harness;
        // the stdin helper never accepts it from requests.
        public static Dictionary<string, object> Run(string directory, string action, string payload, string expectedRevision, Action<string> checkpoint) {
            if (action != "read" && action != "write") throw Fail();
            if (String.IsNullOrEmpty(directory) || directory.Length > 220 || directory.StartsWith("\\\\") ||
                directory.IndexOf(':', 2) >= 0 || directory.IndexOf("..", StringComparison.Ordinal) >= 0 ||
                !Path.IsPathRooted(directory) || !String.Equals(directory, Path.GetFullPath(directory), StringComparison.OrdinalIgnoreCase)) throw Fail();
            string volume = Path.GetPathRoot(directory);
            if (new DriveInfo(volume).DriveFormat != "NTFS" || directory == volume) throw Fail();
            SecurityIdentifier owner = WindowsIdentity.GetCurrent().User;
            List<SafeFileHandle> pins = new List<SafeFileHandle>();
            try {
                string parent = Path.GetDirectoryName(directory);
                Stack<string> ancestors = new Stack<string>();
                while (!String.IsNullOrEmpty(parent)) { ancestors.Push(parent); parent = Path.GetDirectoryName(parent); }
                while (ancestors.Count != 0) pins.Add(Pin(ancestors.Pop()));
                if (!System.IO.Directory.Exists(directory)) System.IO.Directory.CreateDirectory(directory, DirectoryAcl(owner));
                pins.Add(Pin(directory)); AssertAcl(directory, true, owner);
                string lockPath = Path.Combine(directory, "state.lock"), target = Path.Combine(directory, "state.json");
                string temporary = Path.Combine(directory, "state.tmp");
                using (SafeFileHandle mutex = OpenFile(lockPath, OpenAlways, Read | Write, owner)) {
                    if (File.Exists(temporary) || System.IO.Directory.Exists(temporary)) throw Fail();
                    string revision; string current = Current(target, owner, out revision);
                    if (action == "read") return new Dictionary<string, object> { {"ok", true}, {"payload", current}, {"revision", revision} };
                    if (!String.Equals(revision ?? "", expectedRevision ?? "", StringComparison.Ordinal)) throw Fail();
                    byte[] bytes = new UTF8Encoding(false, true).GetBytes(payload);
                    if (bytes.Length < 1 || bytes.Length > Limit) throw Fail();
                    using (SafeFileHandle handle = OpenFile(temporary, CreateNew, Read | Write, owner))
                    using (FileStream file = new FileStream(handle, FileAccess.ReadWrite)) {
                        if (checkpoint != null) checkpoint("created");
                        file.Write(bytes, 0, bytes.Length); file.Flush(true);
                        if (checkpoint != null) checkpoint("flushed");
                    }
                    if (current == null) File.Move(temporary, target);
                    else File.Replace(temporary, target, null, false);
                    if (checkpoint != null) checkpoint("committed");
                    AssertAcl(target, false, owner);
                    string committedRevision; string committed = Current(target, owner, out committedRevision);
                    if (committed != payload || committedRevision != Hash(bytes)) throw Fail();
                    return new Dictionary<string, object> { {"ok", true}, {"payload", null}, {"revision", committedRevision} };
                }
            } finally { for (int i = pins.Count - 1; i >= 0; i--) pins[i].Dispose(); }
        }
    }
}
