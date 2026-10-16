$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("server-teleport-build-" + [guid]::NewGuid().ToString('N'))
$Dependencies = Join-Path $TempRoot 'dependencies'
$Classes = Join-Path $TempRoot 'classes'
$TemporaryJar = Join-Path $TempRoot 'ServerTeleport.jar'
$Dist = Join-Path $ProjectRoot 'dist'
$OutputJar = Join-Path $Dist 'ServerTeleport.jar'

# Compile-only APIs are pinned and SHA-512 checked. They are never executed or bundled.
$Artifacts = @(
    @{
        Name = 'paper-api.jar'
        Url = 'https://repo.papermc.io/repository/maven-public/io/papermc/paper/paper-api/1.21.4-R0.1-SNAPSHOT/paper-api-1.21.4-R0.1-20250925.065901-231.jar'
        Sha512 = '12d7b08e094eeb3518248f117ede185ef32084b72f61cabc7452f2e572a6e0ea9eada632cefccfb02a0df6f9a111f53c5fc7a4a1d552aeb972d20a8b3a7ff47b'
    },
    @{
        Name = 'annotations.jar'
        Url = 'https://repo.maven.apache.org/maven2/org/jetbrains/annotations/26.0.2/annotations-26.0.2.jar'
        Sha512 = 'c7be38957318874b837d029dc7b2a1f8b009feaa5362a56cba4f4c8a7d502993b3c900ee338eb9c9ee9494d7fd946bd280403eee28b244d213edb0b145a9ebfd'
    },
    @{
        Name = 'guava.jar'
        Url = 'https://repo.maven.apache.org/maven2/com/google/guava/guava/33.3.1-jre/guava-33.3.1-jre.jar'
        Sha512 = '5fdb406eeafbb7b409bae82924b7c26bdcdea06c7edbb673901814c3d35010bc91139e5139663af0b66f8fa47f54e0e96dd86fdff1797c9ae497c10a466b02e3'
    },
    @{
        Name = 'adventure-api.jar'
        Url = 'https://repo.maven.apache.org/maven2/net/kyori/adventure-api/4.20.0/adventure-api-4.20.0.jar'
        Sha512 = '27d5a738ff8e97af2cb6b1a23f52fa1a495bd6e51b4a0fe920d40ff704e062f380364c257205edd0c54ef480dc39ab844af29a0ba16e024483fbdad742164a7e'
    },
    @{
        Name = 'adventure-key.jar'
        Url = 'https://repo.maven.apache.org/maven2/net/kyori/adventure-key/4.20.0/adventure-key-4.20.0.jar'
        Sha512 = '2448c0d731b8f48e87594bce5de5a1488abd74c47a70cc5f6e67bbbc26bacb698110578aee9a826fd13b3621205bc14807d1cc232ce1487581e060ab600bd542'
    },
    @{
        Name = 'examination-api.jar'
        Url = 'https://repo.maven.apache.org/maven2/net/kyori/examination-api/1.3.0/examination-api-1.3.0.jar'
        Sha512 = '4538048fb721f942f6fa13d92c80a983edddc3621936916e870fa031c8b2e1568d2b6fd649d8151dc3cc059ae761c213ea7c1cc78bee62802dc24b9cb09c903f'
    },
    @{
        Name = 'examination-string.jar'
        Url = 'https://repo.maven.apache.org/maven2/net/kyori/examination-string/1.3.0/examination-string-1.3.0.jar'
        Sha512 = '22624cb3c9f0555d968534611a492d1e06dc028ace9f7ce3550e52400b57ba779a5b2e1da3e2af5f2cb83b7f197796344652c76f74ddb0b8f126748530bfadea'
    },
    @{
        Name = 'bungeecord-chat.jar'
        Url = 'https://repo.papermc.io/repository/maven-public/net/md-5/bungeecord-chat/1.20-R0.2-deprecated+build.19/bungeecord-chat-1.20-R0.2-deprecated+build.19.jar'
        Sha512 = '0d860a43aca6e9fb8f9d487f9eca4c0a4f8dce09eab71d41053dacc35f1b96c0019860705f53a30b17f9ece11a7912255162b7e4ac40ac1a8f909c09dea5b89a'
    }
)

function Assert-Tool([string] $Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name is required. Install a JDK 21 or newer and try again."
    }
}

try {
    Assert-Tool 'javac'
    Assert-Tool 'jar'
    New-Item -ItemType Directory -Force -Path $Dependencies, $Classes, $Dist | Out-Null

    foreach ($Artifact in $Artifacts) {
        $Destination = Join-Path $Dependencies $Artifact.Name
        Invoke-WebRequest -UseBasicParsing -Uri $Artifact.Url -OutFile $Destination -TimeoutSec 45
        $Actual = (Get-FileHash -LiteralPath $Destination -Algorithm SHA512).Hash.ToLowerInvariant()
        if ($Actual -ne $Artifact.Sha512) {
            throw "Integrity check failed for $($Artifact.Name). Expected $($Artifact.Sha512), got $Actual."
        }
    }

    $ClassPath = ($Artifacts | ForEach-Object { Join-Path $Dependencies $_.Name }) -join [System.IO.Path]::PathSeparator
    $Sources = Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'src/main/java') -Recurse -Filter '*.java' | ForEach-Object FullName
    if (-not $Sources) { throw 'No Java sources were found.' }
    & javac --release 21 -encoding UTF-8 -cp $ClassPath -d $Classes $Sources
    if ($LASTEXITCODE -ne 0) { throw "javac failed with exit code $LASTEXITCODE" }

    Copy-Item -LiteralPath (Join-Path $ProjectRoot 'src/main/resources/plugin.yml') -Destination $Classes
    Copy-Item -LiteralPath (Join-Path $ProjectRoot 'src/main/resources/config.yml') -Destination $Classes
    & jar --create --file $TemporaryJar -C $Classes .
    if ($LASTEXITCODE -ne 0) { throw "jar failed with exit code $LASTEXITCODE" }

    $Entries = & jar --list --file $TemporaryJar
    if ($LASTEXITCODE -ne 0 -or $Entries -notcontains 'plugin.yml' -or
            $Entries -notcontains 'com/servermanager/teleport/ServerTeleportPlugin.class') {
        throw 'The generated JAR is missing its descriptor or plugin entry point.'
    }

    Move-Item -LiteralPath $TemporaryJar -Destination $OutputJar -Force
    $OutputHash = (Get-FileHash -LiteralPath $OutputJar -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Output "Built $OutputJar"
    Write-Output "SHA-256 $OutputHash"
}
finally {
    $ResolvedTempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $ResolvedTarget = [System.IO.Path]::GetFullPath($TempRoot)
    if ($ResolvedTarget.StartsWith($ResolvedTempBase, [System.StringComparison]::OrdinalIgnoreCase) -and
            (Test-Path -LiteralPath $ResolvedTarget)) {
        Remove-Item -LiteralPath $ResolvedTarget -Recurse -Force
    }
}
