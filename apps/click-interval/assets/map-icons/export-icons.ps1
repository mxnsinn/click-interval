$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Drawing
$assetDirectory = [IO.Path]::GetFullPath($PSScriptRoot)
$sourcesDirectory = Join-Path $assetDirectory 'sources'
[IO.Directory]::CreateDirectory($sourcesDirectory) | Out-Null
$records = Get-Content -LiteralPath (Join-Path $assetDirectory 'prompts.json') -Raw | ConvertFrom-Json
$results = @()
foreach ($record in $records) {
    if ($record.name -notmatch '^[a-z_]+$') { throw 'Invalid icon name' }
    $copiedSource = Join-Path $sourcesDirectory ($record.name + '.png')
    if (!(Test-Path -LiteralPath $copiedSource)) { Copy-Item -LiteralPath $record.source -Destination $copiedSource }
    if ((Get-FileHash -LiteralPath $copiedSource).Hash -ne (Get-FileHash -LiteralPath $record.source).Hash) { throw 'Source differs from generated icon' }
    $sourceImage = [Drawing.Bitmap]::new($copiedSource)
    try {
        if ($sourceImage.Width -ne $sourceImage.Height -or $sourceImage.GetPixel(0,0).A -ne 0) { throw 'Expected transparent square generated source' }
        $destination = Join-Path $assetDirectory ($record.name + '.png')
        if (!(Test-Path -LiteralPath $destination)) {
            # Technical size conversion only; generated shape/colors/alpha are preserved.
            $bitmap = [Drawing.Bitmap]::new(32,32,[Drawing.Imaging.PixelFormat]::Format32bppArgb)
            $graphics = [Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.Clear([Drawing.Color]::Transparent)
                $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
                $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
                $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::Half
                $graphics.DrawImage($sourceImage,[Drawing.Rectangle]::new(0,0,32,32))
                $bitmap.Save($destination,[Drawing.Imaging.ImageFormat]::Png)
            } finally { $graphics.Dispose(); $bitmap.Dispose() }
        }
        $check = [Drawing.Bitmap]::new($destination)
        try {
            if ($check.Width -ne 32 -or $check.Height -ne 32 -or $check.GetPixel(0,0).A -ne 0) { throw 'Bad icon export' }
        } finally { $check.Dispose() }
        $results += [pscustomobject]@{name=$record.name;file=$destination;sha256=(Get-FileHash -LiteralPath $destination).Hash.ToLowerInvariant()}
    } finally { $sourceImage.Dispose() }
}
$results | ConvertTo-Json -Depth 3
