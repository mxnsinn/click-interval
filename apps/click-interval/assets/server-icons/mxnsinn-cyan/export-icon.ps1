$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Drawing
# Technical PNG size conversion only; preserves the generated design and transparency.
$assetDirectory = [IO.Path]::GetFullPath($PSScriptRoot)
$sourcePath = Join-Path $assetDirectory 'source.png'
$sourceImage = [Drawing.Bitmap]::new($sourcePath)
$results = @()
try {
    if ($sourceImage.Width -ne $sourceImage.Height) { throw 'Expected a square source image.' }
    if ($sourceImage.GetPixel(0,0).A -ne 0) { throw 'Source background is not transparent.' }
    foreach ($size in @(64, 256)) {
        $fileName = if ($size -eq 64) { 'server-icon.png' } else { 'preview.png' }
        $destination = Join-Path $assetDirectory $fileName
        if (Test-Path -LiteralPath $destination) { throw "Output already exists: $destination" }
        $bitmap = [Drawing.Bitmap]::new($size, $size, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.Clear([Drawing.Color]::Transparent)
            $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
            $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $graphics.DrawImage($sourceImage, [Drawing.Rectangle]::new(0,0,$size,$size))
            $opaque = 0; $transparent = 0; $cyan = 0
            for ($y=0; $y -lt $size; $y++) {
                for ($x=0; $x -lt $size; $x++) {
                    $pixel = $bitmap.GetPixel($x,$y)
                    if ($pixel.A -eq 0) { $transparent++ }
                    if ($pixel.A -gt 200) {
                        $opaque++
                        if ($pixel.G -gt $pixel.R -and $pixel.B -gt $pixel.R) { $cyan++ }
                    }
                    if (($x -eq 0 -or $y -eq 0 -or $x -eq ($size-1) -or $y -eq ($size-1)) -and $pixel.A -ne 0) { throw 'Non-transparent border.' }
                }
            }
            if ($transparent -lt ($size*$size*0.15) -or $opaque -lt ($size*$size*0.15) -or $cyan -lt ($opaque*0.98)) { throw 'Alpha/color validation failed.' }
            $bitmap.Save($destination, [Drawing.Imaging.ImageFormat]::Png)
            $results += [pscustomobject]@{file=$destination;size=$size;opaquePixels=$opaque;transparentPixels=$transparent;cyanPixels=$cyan;sha256=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()}
        } finally { $graphics.Dispose(); $bitmap.Dispose() }
    }
} finally { $sourceImage.Dispose() }
$results | ConvertTo-Json -Depth 3
