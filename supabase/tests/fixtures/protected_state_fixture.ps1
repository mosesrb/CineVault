# Synthetic test fixture only. Never use production paths or print state.
$ErrorActionPreference = 'Stop'
try {
    $r = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $base = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../runtime/qa/protected-store-tests'))
    $dir = [IO.Path]::GetFullPath([string]$r.directory)
    if ([IO.Path]::GetDirectoryName($dir) -ne $base -or [IO.Path]::GetFileName($dir) -notmatch '^case-[0-9a-f-]{36}$') { throw 'unsafe_fixture' }
    $file = Join-Path $dir 'state.json'
    switch ([string]$r.action) {
        'directoryAcl' {
            [Console]::Out.Write([IO.Directory]::GetAccessControl($dir).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access))
        }
        'acl' {
            $d = [IO.Directory]::GetAccessControl($dir)
            $f = [IO.File]::GetAccessControl($file)
            [Console]::Out.Write((@{directoryProtected=$d.AreAccessRulesProtected; fileProtected=$f.AreAccessRulesProtected;
                directoryPrincipals=@($d.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value });
                filePrincipals=@($f.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value });
                owner=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value} | ConvertTo-Json -Compress))
        }
        'tamper' {
            $acl = [IO.File]::GetAccessControl($file)
            $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
                [Security.Principal.SecurityIdentifier]::new('S-1-1-0'), [Security.AccessControl.FileSystemRights]::Read,
                [Security.AccessControl.AccessControlType]::Allow))
            [IO.File]::SetAccessControl($file, $acl)
            [Console]::Out.Write('{}')
        }
        'crash' {
            Add-Type -Path (Join-Path $PSScriptRoot '../../../scripts/prototypes/ProtectedState.cs')
            $point = [string]$r.point
            if ($point -notin @('created','flushed','committed')) { throw 'invalid_point' }
            $hook = [Action[string]]{ param($stage)
                if ($stage -eq 'created') {
                    $tmp = Join-Path $dir 'state.tmp'
                    $acl = [IO.File]::GetAccessControl($tmp)
                    [Console]::Out.Write((@{temporaryProtected=$acl.AreAccessRulesProtected;
                        principals=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value });
                        owner=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value} | ConvertTo-Json -Compress))
                }
                if ($stage -eq $point) { [Environment]::Exit(73) }
            }
            [CineVaultPrototype.ProtectedState]::Run($dir, 'write', [string]$r.payload, [string]$r.revision, $hook) | Out-Null
            throw 'checkpoint_missing'
        }
        default { throw 'invalid_fixture_action' }
    }
} catch { [Console]::Error.Write(('synthetic_fixture_failure:' + $_.Exception.GetType().Name + ':line' + $_.InvocationInfo.ScriptLineNumber)); exit 1 }
