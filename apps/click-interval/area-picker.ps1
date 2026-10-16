Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName WindowsBase

$virtual = [System.Windows.Forms.SystemInformation]::VirtualScreen
$window = New-Object System.Windows.Window
$window.WindowStyle = [System.Windows.WindowStyle]::None
$window.ResizeMode = [System.Windows.ResizeMode]::NoResize
$window.AllowsTransparency = $true
$window.Background = [System.Windows.Media.Brushes]::Transparent
$window.Topmost = $true
$window.ShowInTaskbar = $false
$window.Left = $virtual.Left
$window.Top = $virtual.Top
$window.Width = $virtual.Width
$window.Height = $virtual.Height
$window.Cursor = [System.Windows.Input.Cursors]::Cross

$canvas = New-Object System.Windows.Controls.Canvas
$canvas.Background = [System.Windows.Media.Brushes]::Transparent
$window.Content = $canvas
$shadeBrush = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromArgb(174, 0, 0, 0))

function New-Shade {
  $shape = New-Object System.Windows.Shapes.Rectangle
  $shape.Fill = $shadeBrush
  $canvas.Children.Add($shape) | Out-Null
  return $shape
}

$shadeTop = New-Shade
$shadeLeft = New-Shade
$shadeRight = New-Shade
$shadeBottom = New-Shade
$selection = New-Object System.Windows.Shapes.Rectangle
$selection.Stroke = [System.Windows.Media.Brushes]::White
$selection.StrokeThickness = 2
$dashPattern = New-Object System.Windows.Media.DoubleCollection
$dashPattern.Add(4)
$dashPattern.Add(3)
$selection.StrokeDashArray = $dashPattern
$selection.Visibility = [System.Windows.Visibility]::Hidden
$canvas.Children.Add($selection) | Out-Null

$hint = New-Object System.Windows.Controls.Border
$hint.Background = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromArgb(230, 16, 16, 16))
$hint.BorderBrush = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.Color]::FromRgb(85, 85, 85))
$hint.BorderThickness = 1
$hint.CornerRadius = 4
$hint.Padding = '11,7'
$hintText = New-Object System.Windows.Controls.TextBlock
$hintText.Text = 'Click and drag to select an area. Press Escape to cancel.'
$hintText.Foreground = [System.Windows.Media.Brushes]::White
$hintText.FontFamily = 'Segoe UI'
$hintText.FontSize = 12
$hint.Child = $hintText
$canvas.Children.Add($hint) | Out-Null

$start = $null
$result = $null

function Set-ShapeBounds($shape, $left, $top, $width, $height) {
  [System.Windows.Controls.Canvas]::SetLeft($shape, [double]$left)
  [System.Windows.Controls.Canvas]::SetTop($shape, [double]$top)
  $shape.Width = [Math]::Max(0, [double]$width)
  $shape.Height = [Math]::Max(0, [double]$height)
}

function Draw-Selection($point) {
  $left = [Math]::Min($start.X, $point.X)
  $top = [Math]::Min($start.Y, $point.Y)
  $right = [Math]::Max($start.X, $point.X)
  $bottom = [Math]::Max($start.Y, $point.Y)
  $width = [Math]::Max(1, $right - $left)
  $height = [Math]::Max(1, $bottom - $top)
  Set-ShapeBounds $shadeTop 0 0 $window.ActualWidth $top
  Set-ShapeBounds $shadeLeft 0 $top $left $height
  Set-ShapeBounds $shadeRight $right $top ($window.ActualWidth - $right) $height
  Set-ShapeBounds $shadeBottom 0 $bottom $window.ActualWidth ($window.ActualHeight - $bottom)
  Set-ShapeBounds $selection $left $top $width $height
  $selection.Visibility = [System.Windows.Visibility]::Visible
  return @{ x = $left; y = $top; width = $width; height = $height }
}

$window.Add_Loaded({
  Set-ShapeBounds $shadeTop 0 0 $window.ActualWidth $window.ActualHeight
  Set-ShapeBounds $shadeLeft 0 0 0 0
  Set-ShapeBounds $shadeRight 0 0 0 0
  Set-ShapeBounds $shadeBottom 0 0 0 0
  $hint.Measure((New-Object System.Windows.Size ([double]::PositiveInfinity), ([double]::PositiveInfinity)))
  [System.Windows.Controls.Canvas]::SetLeft($hint, ($window.ActualWidth - $hint.DesiredSize.Width) / 2)
  [System.Windows.Controls.Canvas]::SetTop($hint, 22)
  $window.Activate() | Out-Null
  $window.Focus() | Out-Null
})

$window.Add_MouseLeftButtonDown({
  param($sender, $event)
  $script:start = $event.GetPosition($canvas)
  $canvas.CaptureMouse() | Out-Null
  Draw-Selection $script:start | Out-Null
})

$window.Add_MouseMove({
  param($sender, $event)
  if ($null -ne $script:start -and $event.LeftButton -eq [System.Windows.Input.MouseButtonState]::Pressed) {
    Draw-Selection ($event.GetPosition($canvas)) | Out-Null
  }
})

$window.Add_MouseLeftButtonUp({
  param($sender, $event)
  if ($null -eq $script:start) { return }
  $rect = Draw-Selection ($event.GetPosition($canvas))
  $canvas.ReleaseMouseCapture()
  $script:start = $null
  if ($rect.width -lt 3 -or $rect.height -lt 3) { return }
  $payload = @{
    canceled = $false
    x = [Math]::Round($window.Left + $rect.x)
    y = [Math]::Round($window.Top + $rect.y)
    width = [Math]::Round($rect.width)
    height = [Math]::Round($rect.height)
  }
  $script:result = $payload
  $window.Close()
})

$window.Add_KeyDown({
  param($sender, $event)
  if ($event.Key -eq [System.Windows.Input.Key]::Escape) {
    $script:result = @{ canceled = $true }
    $window.Close()
  }
})

$window.Add_Closed({
  if ($null -eq $script:result) { $script:result = @{ canceled = $true } }
})

$window.ShowDialog() | Out-Null
Write-Output ($result | ConvertTo-Json -Compress)
