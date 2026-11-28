# Convert one Word, Excel or PowerPoint file to PDF with the Office installed on
# this Windows machine. Called by scripts/source-redact.ts when LibreOffice is
# not available. Macros are force-disabled and the file is opened read-only
# from a temporary copy, so nothing in the archive is changed or run.
#
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File office-to-pdf.ps1 -In C:\path\file.docx -Out C:\path\file.pdf
#
# The copy and the PDF sit directly in %TEMP% under unique names: exporting
# into a freshly made work folder stalled Word under automation.
param([string] $In, [string] $Out)
if (-not $In -or -not $Out) { Write-Error 'Usage: office-to-pdf.ps1 -In FILE -Out FILE.pdf'; exit 2 }
$ext = [IO.Path]::GetExtension($In).ToLowerInvariant()
$stem = Join-Path $env:TEMP ('office-to-pdf-' + [guid]::NewGuid())
$src = $stem + $ext
$pdf = $stem + '.pdf'
Copy-Item -LiteralPath $In -Destination $src
$ForceDisable = 3  # msoAutomationSecurityForceDisable
$app = $null
try {
    if ($ext -match '^\.(docx?|rtf|odt)$') {
        $app = New-Object -ComObject Word.Application
        $app.Visible = $false; $app.DisplayAlerts = 0; $app.AutomationSecurity = $ForceDisable
        $doc = $app.Documents.Open($src, $false, $true, $false)
        $doc.ExportAsFixedFormat($pdf, 17)  # wdExportFormatPDF
        $doc.Close(0)
    } elseif ($ext -match '^\.(xlsx?|xlsm|ods|csv)$') {
        $app = New-Object -ComObject Excel.Application
        $app.Visible = $false; $app.DisplayAlerts = $false; $app.AutomationSecurity = $ForceDisable
        $book = $app.Workbooks.Open($src, 0, $true)
        $book.ExportAsFixedFormat(0, $pdf)  # xlTypePDF, every sheet
        $book.Close($false)
    } elseif ($ext -match '^\.(pptx?|odp)$') {
        $app = New-Object -ComObject PowerPoint.Application
        $app.AutomationSecurity = $ForceDisable
        $deck = $app.Presentations.Open($src, -1, 0, 0)  # read-only, untitled, no window
        $deck.SaveAs($pdf, 32)  # ppSaveAsPDF
        $deck.Close()
    } else {
        Write-Error "Unsupported file type $ext"; exit 2
    }
    Copy-Item -LiteralPath $pdf -Destination $Out -Force
} finally {
    if ($app) { $app.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app) }
    Remove-Item -LiteralPath $src, $pdf -Force -ErrorAction SilentlyContinue
}
