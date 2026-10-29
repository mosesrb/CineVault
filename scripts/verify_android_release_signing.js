// Exercise the real Gradle task graph without Android dependencies or key material.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const android = path.join(root, 'frontend/android');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'cinevault-signing-policy-'));
const variables = ['CINEVAULT_KEYSTORE_PATH', 'CINEVAULT_KEYSTORE_PASSWORD', 'CINEVAULT_KEY_ALIAS', 'CINEVAULT_KEY_PASSWORD'];
const marker = 'CV_SYNTHETIC_PACKAGE_EXECUTED';
const fakePassword = 'synthetic-policy-value-only';
const policy = path.join(android, 'app/release-signing.gradle').replaceAll('\\', '/');
const releaseTasks = ['validateSigningRelease', 'packageRelease', 'packageReleaseBundle', 'signReleaseBundle', 'assembleRelease', 'bundleRelease', 'installRelease', 'packageDemoRelease'];
let passed = 0;

function run(name, taskNames, values, expectedSuccess, message) {
  const env = { ...process.env };
  for (const variable of variables) delete env[variable];
  Object.assign(env, values);
  const args = ['--project-dir', fixture, '--offline', '--no-daemon', '--no-configuration-cache', '--console=plain', ...taskNames];
  // Invoke the wrapper jar directly: no shell quoting or secret-valued arguments.
  const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
  const result = spawnSync(java, ['-classpath', path.join(android, 'gradle/wrapper/gradle-wrapper.jar'), 'org.gradle.wrapper.GradleWrapperMain', ...args], {
    cwd: android, env, encoding: 'utf8', timeout: 180000, windowsHide: true, maxBuffer: 4 * 1024 * 1024
  });
  assert.ifError(result.error);
  const output = result.stdout + result.stderr;
  assert(!output.includes(fakePassword), `${name}: a synthetic secret was logged`);
  assert(!output.includes(fixture), `${name}: a signing path was logged`);
  assert.equal(result.status === 0, expectedSuccess, `${name}: unexpected Gradle exit; ${output.replaceAll(fixture, '<fixture>')}`);
  if (expectedSuccess) {
    assert(output.includes(marker), `${name}: expected task did not execute`);
  } else {
    assert(output.includes(message), `${name}: expected configuration refusal missing`);
    assert(!output.includes(marker), `${name}: packaging executed before refusal`);
  }
  passed += 1;
  console.log(`PASS ${name}`);
}

try {
  fs.writeFileSync(path.join(fixture, 'settings.gradle'), "rootProject.name = 'cinevault-signing-policy'\n");
  fs.writeFileSync(path.join(fixture, 'gradle.properties'), 'org.gradle.jvmargs=-Xmx256m\n');
  const declarations = [...releaseTasks, 'assembleDebug', 'processReleaseMainManifest', 'preReleaseBuild'].map(name =>
    `tasks.register('${name}') { doLast { println('${marker}') } }`).join('\n');
  const wiringCheck = `tasks.register('verifyGuardWiring') { doLast {
    ${JSON.stringify(releaseTasks)}.each { taskName ->
      assert tasks.getByName(taskName).taskDependencies.getDependencies(tasks.getByName(taskName))*.name.contains('verifyCineVaultReleaseSigning')
    }
    ['assembleDebug', 'processReleaseMainManifest', 'preReleaseBuild'].each { taskName ->
      assert !tasks.getByName(taskName).taskDependencies.getDependencies(tasks.getByName(taskName))*.name.contains('verifyCineVaultReleaseSigning')
    }
  } }`;
  fs.writeFileSync(path.join(fixture, 'build.gradle'), `apply from: '${policy.replaceAll("'", "\\'")}'\n${declarations}\ncinevaultRequireReleaseSigning('release')\ncinevaultRequireReleaseSigning('demoRelease')\n${wiringCheck}\n`);
  const fakeFile = path.join(fixture, 'synthetic-not-a-keystore.txt');
  fs.writeFileSync(fakeFile, 'Not a private key. Configuration-policy fixture only.\n');
  const complete = Object.fromEntries(variables.map(name => [name, fakePassword]));
  complete.CINEVAULT_KEYSTORE_PATH = fakeFile;
  run('task wiring, debug and release manifest need no signing', ['verifyGuardWiring', 'assembleDebug', 'processReleaseMainManifest', 'preReleaseBuild'], {}, true);
  run('missing signing blocks release packaging', ['packageRelease'], {}, false, 'Release signing is not configured');
  for (const variable of variables) {
    const partial = { ...complete };
    delete partial[variable];
    run(`missing ${variable}`, ['assembleRelease'], partial, false, variable);
  }
  run('blank password fails closed', ['bundleRelease'], { ...complete, CINEVAULT_KEY_PASSWORD: '   ' }, false, 'Release signing is not configured');
  run('missing keystore fails closed', ['signReleaseBundle'], { ...complete, CINEVAULT_KEYSTORE_PATH: path.join(fixture, 'missing') }, false, 'readable keystore file');
  run('directory is not a keystore', ['installRelease'], { ...complete, CINEVAULT_KEYSTORE_PATH: fixture }, false, 'readable keystore file');
  run('flavored release is guarded', ['packageDemoRelease'], {}, false, 'Release signing is not configured');
  run('complete configuration permits all guarded task types', releaseTasks, complete, true);
  console.log(`Android signing configuration policy: ${passed} passed. No actual signing or Android compilation performed.`);
} finally {
  // Only the exact unique fixture created by this process; no user files.
  const resolved = path.resolve(fixture);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert(path.basename(resolved).startsWith('cinevault-signing-policy-'));
  fs.rmSync(resolved, { recursive: true, force: true });
}
