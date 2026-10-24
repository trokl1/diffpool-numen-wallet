param(
 [string]$Sdk=$env:ANDROID_HOME, [string]$Jdk=$env:JAVA_HOME,
 [string]$KeyStore='', [string]$Alias='numen',
 [string]$PasswordEnv='NUMEN_SIGNING_PASSWORD', [switch]$Qa
)
$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot)
if(!$Sdk -or !$Jdk){throw 'Pass -Sdk and -Jdk (Android platform 35/build-tools 34.0.0, JDK 17).'}
if(!$KeyStore -or !(Test-Path -LiteralPath $KeyStore)){throw 'Signing keystore is required. Never reuse the Pearl key.'}
if(![Environment]::GetEnvironmentVariable($PasswordEnv)){throw 'Set the password in the named environment variable; never put it on the command line.'}
$tools=Join-Path $Sdk 'build-tools\34.0.0'
$platform=Join-Path $Sdk 'platforms\android-35\android.jar'
$env:JAVA_HOME=$Jdk
$env:PATH="$Jdk\bin;$env:PATH"
function Check { if($LASTEXITCODE -ne 0){throw "Build failed with exit code $LASTEXITCODE"} }
$mode=if($Qa){'qa'}else{'release'}
$dest=Join-Path $PWD "build\$mode"
New-Item -ItemType Directory -Force $dest,"$dest\classes","$dest\dex","$dest\assets" | Out-Null
& npm.cmd run bundle;Check
& node scripts/localization.mjs;Check
Copy-Item web/* "$dest\assets" -Force
& node scripts/notices.mjs;Check
Copy-Item THIRD-PARTY-NOTICES.txt "$dest\assets" -Force
& "$tools\aapt2.exe" compile --dir android/res -o "$dest\res.zip";Check
$manifest=(Resolve-Path android/AndroidManifest.xml).Path
if($Qa){
 # Mechanical build-time manifest transform; source remains non-debuggable.
 $qaManifest=Join-Path $dest 'AndroidManifest.xml'
 [IO.File]::WriteAllText($qaManifest,[IO.File]::ReadAllText($manifest).Replace('android:debuggable="false"','android:debuggable="true"'))
 $manifest=$qaManifest
}
& "$tools\aapt2.exe" link -o "$dest\base.apk" -I $platform --manifest $manifest --auto-add-overlay "$dest\res.zip" -A "$dest\assets";Check
$sources=@(Get-ChildItem android/src -Filter '*.java' -Recurse | ForEach-Object FullName)
& "$Jdk\bin\javac.exe" -encoding UTF-8 -source 8 -target 8 -classpath $platform -d "$dest\classes" $sources;Check
$classes=@(Get-ChildItem "$dest\classes" -Filter '*.class' -Recurse | ForEach-Object FullName)
& "$tools\d8.bat" --release --min-api 28 --lib $platform --output "$dest\dex" $classes;Check
Copy-Item "$dest\base.apk" "$dest\unsigned.apk" -Force
Push-Location "$dest\dex"
try{& "$Jdk\bin\jar.exe" uf "$dest\unsigned.apk" classes.dex;Check}finally{Pop-Location}
& "$tools\zipalign.exe" -f -p 4 "$dest\unsigned.apk" "$dest\aligned.apk";Check
$version=(Get-Content package.json -Raw | ConvertFrom-Json).version
$apk="$dest\DiffPool-NUMEN-$version-$mode.apk"
& "$tools\apksigner.bat" sign --ks $KeyStore --ks-key-alias $Alias --ks-pass "env:$PasswordEnv" --key-pass "env:$PasswordEnv" --out $apk "$dest\aligned.apk";Check
& "$tools\apksigner.bat" verify --verbose --print-certs $apk;Check
Get-FileHash -LiteralPath $apk -Algorithm SHA256
