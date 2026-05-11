Add-Type -AssemblyName System.Drawing

$bmp = New-Object System.Drawing.Bitmap(128,128)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Transparent)

# Outer flame - orange
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,107,53))
$points = @(
    [System.Drawing.PointF]::new(64,8),
    [System.Drawing.PointF]::new(24,80),
    [System.Drawing.PointF]::new(40,120),
    [System.Drawing.PointF]::new(64,100),
    [System.Drawing.PointF]::new(88,120),
    [System.Drawing.PointF]::new(104,80)
)
$g.FillClosedCurve($brush, $points)

# Inner flame - gold
$brush2 = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255,215,0))
$points2 = @(
    [System.Drawing.PointF]::new(64,48),
    [System.Drawing.PointF]::new(48,88),
    [System.Drawing.PointF]::new(56,108),
    [System.Drawing.PointF]::new(64,96),
    [System.Drawing.PointF]::new(72,108),
    [System.Drawing.PointF]::new(80,88)
)
$g.FillClosedCurve($brush2, $points2)

$bmp.Save("$PSScriptRoot\infernoflow-128.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Host "PNG icon created at $PSScriptRoot\infernoflow-128.png"
