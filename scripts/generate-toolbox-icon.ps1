param(
  [string]$OutputPath = (Join-Path $PSScriptRoot 'app\assets\toolbox-icon.ico'),
  [string]$PngOutputPath = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function New-RoundedRectanglePath {
  param([float]$X, [float]$Y, [float]$Width, [float]$Height, [float]$Radius)
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = [Math]::Max(1, $Radius * 2)
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-ToolboxPng {
  param([int]$Size)
  $bitmap = [System.Drawing.Bitmap]::new(256, 256, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $light = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 230, 232, 234))
    $blue = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 21, 155, 215))
    $dark = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 9, 10, 12))
    try {
      $handle = New-RoundedRectanglePath -X 82 -Y 32 -Width 92 -Height 70 -Radius 24
      $body = New-RoundedRectanglePath -X 32 -Y 72 -Width 192 -Height 148 -Radius 28
      $latch = New-RoundedRectanglePath -X 112 -Y 123 -Width 32 -Height 42 -Radius 7
      $latchInset = New-RoundedRectanglePath -X 119 -Y 129 -Width 18 -Height 18 -Radius 4
      try {
        $graphics.FillPath($light, $handle)
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $clear = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::Transparent)
        try { $graphics.FillRectangle($clear, 102, 51, 52, 34) } finally { $clear.Dispose() }
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
        $graphics.FillPath($light, $body)
        $graphics.FillRectangle($blue, 32, 111, 192, 34)
        $graphics.FillPath($dark, $latch)
        $graphics.FillPath($light, $latchInset)
      } finally {
        $handle.Dispose(); $body.Dispose(); $latch.Dispose(); $latchInset.Dispose()
      }
    } finally {
      $light.Dispose(); $blue.Dispose(); $dark.Dispose()
    }
  } finally {
    $graphics.Dispose()
  }

  $resized = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $resizeGraphics = [System.Drawing.Graphics]::FromImage($resized)
  try {
    $resizeGraphics.Clear([System.Drawing.Color]::Transparent)
    $resizeGraphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $resizeGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $resizeGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $resizeGraphics.DrawImage($bitmap, 0, 0, $Size, $Size)
  } finally {
    $resizeGraphics.Dispose()
    $bitmap.Dispose()
  }
  $stream = [System.IO.MemoryStream]::new()
  try {
    $resized.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    return ,$stream.ToArray()
  } finally {
    $stream.Dispose()
    $resized.Dispose()
  }
}

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = @($sizes | ForEach-Object { New-ToolboxPng -Size $_ })
$headerSize = 6 + (16 * $sizes.Count)
$offset = $headerSize
$output = [System.IO.MemoryStream]::new()
$writer = [System.IO.BinaryWriter]::new($output)
try {
  $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Count)
  for ($index = 0; $index -lt $sizes.Count; $index += 1) {
    $sizeByte = if ($sizes[$index] -eq 256) { 0 } else { $sizes[$index] }
    $writer.Write([byte]$sizeByte); $writer.Write([byte]$sizeByte)
    $writer.Write([byte]0); $writer.Write([byte]0)
    $writer.Write([uint16]1); $writer.Write([uint16]32)
    $writer.Write([uint32]$images[$index].Length); $writer.Write([uint32]$offset)
    $offset += $images[$index].Length
  }
  foreach ($image in $images) { $writer.Write($image) }
  $writer.Flush()
  $resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
  New-Item -ItemType Directory -Path ([System.IO.Path]::GetDirectoryName($resolvedOutput)) -Force | Out-Null
  [System.IO.File]::WriteAllBytes($resolvedOutput, $output.ToArray())
  if ($PngOutputPath) {
    $resolvedPngOutput = [System.IO.Path]::GetFullPath($PngOutputPath)
    New-Item -ItemType Directory -Path ([System.IO.Path]::GetDirectoryName($resolvedPngOutput)) -Force | Out-Null
    [System.IO.File]::WriteAllBytes($resolvedPngOutput, $images[$images.Count - 1])
  }
  $resolvedOutput
} finally {
  $writer.Dispose(); $output.Dispose()
}
