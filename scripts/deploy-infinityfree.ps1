$ErrorActionPreference = "Stop"
$envPath = Join-Path (Get-Location) ".env.deploy.local"
$distPath = (Resolve-Path -LiteralPath "dist").Path
$workspacePath = (Resolve-Path -LiteralPath ".").Path

if (-not $distPath.StartsWith($workspacePath, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Folder dist berada di luar workspace."
}

$settings = @{}
Get-Content -LiteralPath $envPath | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) { return }
  $separator = $line.IndexOf("=")
  if ($separator -lt 1) { return }
  $key = $line.Substring(0, $separator).Trim()
  $value = $line.Substring($separator + 1).Trim().Trim('"').Trim("'")
  $settings[$key] = $value
}

$required = @("INFINITYFREE_FTP_HOST", "INFINITYFREE_FTP_PORT", "INFINITYFREE_FTP_USER", "INFINITYFREE_FTP_PASSWORD", "INFINITYFREE_FTP_PATH")
foreach ($key in $required) {
  if (-not $settings[$key]) { throw "Variabel $key belum diisi di .env.deploy.local." }
}

$credential = New-Object System.Net.NetworkCredential($settings.INFINITYFREE_FTP_USER, $settings.INFINITYFREE_FTP_PASSWORD)
$remoteRoot = "ftp://$($settings.INFINITYFREE_FTP_HOST):$($settings.INFINITYFREE_FTP_PORT)$($settings.INFINITYFREE_FTP_PATH.TrimEnd('/'))"

function Convert-ToFtpPath([string]$relativePath) {
  return (($relativePath -split '[\\/]') | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/'
}

function New-FtpDirectory([string]$relativePath) {
  $uri = "$remoteRoot/$(Convert-ToFtpPath $relativePath)"
  $request = [System.Net.FtpWebRequest]::Create($uri)
  $request.Method = [System.Net.WebRequestMethods+Ftp]::MakeDirectory
  $request.Credentials = $credential
  $request.UsePassive = $true
  $request.KeepAlive = $false
  try {
    $response = $request.GetResponse()
    $response.Close()
  } catch [System.Net.WebException] {
    if ($_.Exception.Response) { $_.Exception.Response.Close() }
    $check = [System.Net.FtpWebRequest]::Create($uri)
    $check.Method = [System.Net.WebRequestMethods+Ftp]::ListDirectory
    $check.Credentials = $credential
    $check.UsePassive = $true
    $check.KeepAlive = $false
    try {
      $checkResponse = $check.GetResponse()
      $checkResponse.Close()
    } catch {
      throw "Folder FTP '$relativePath' tidak dapat dibuat atau diakses."
    }
  }
}

function Send-FtpFile([System.IO.FileInfo]$file) {
  $relativePath = $file.FullName.Substring($distPath.Length).TrimStart('\', '/')
  if ($relativePath -eq ".htaccess") {
    Write-Host "Unchanged: $relativePath"
    return $null
  }
  $uri = "$remoteRoot/$(Convert-ToFtpPath $relativePath)"
  if ($relativePath -ne "index.html") {
    $check = [System.Net.FtpWebRequest]::Create($uri)
    $check.Method = [System.Net.WebRequestMethods+Ftp]::GetFileSize
    $check.Credentials = $credential
    $check.UsePassive = $true
    $check.KeepAlive = $false
    try {
      $checkResponse = $check.GetResponse()
      $checkResponse.Close()
      # Nama aset Vite memakai content hash; nama sama berarti konten sama.
      Write-Host "Unchanged: $relativePath"
      return $null
    } catch [System.Net.WebException] {
      if ($_.Exception.Response) { $_.Exception.Response.Close() }
    }
  }
  $request = [System.Net.FtpWebRequest]::Create($uri)
  $request.Method = [System.Net.WebRequestMethods+Ftp]::UploadFile
  $request.Credentials = $credential
  $request.UseBinary = $true
  $request.UsePassive = $true
  $request.KeepAlive = $false
  $request.ContentLength = $file.Length
  $source = [System.IO.File]::OpenRead($file.FullName)
  try {
    $destination = $request.GetRequestStream()
    try { $source.CopyTo($destination) } finally { $destination.Close() }
    $response = $request.GetResponse()
    try { return $relativePath } finally { $response.Close() }
  } finally {
    $source.Close()
  }
}

$directories = Get-ChildItem -LiteralPath $distPath -Directory -Recurse | Sort-Object FullName
foreach ($directory in $directories) {
  $relative = $directory.FullName.Substring($distPath.Length).TrimStart('\', '/')
  New-FtpDirectory $relative
}

$files = Get-ChildItem -LiteralPath $distPath -File -Recurse | Sort-Object @{ Expression = { if ($_.Name -eq "index.html") { 1 } else { 0 } } }, FullName
$uploaded = 0
foreach ($file in $files) {
  $pending = $file.FullName.Substring($distPath.Length).TrimStart('\', '/')
  Write-Output "Uploading: $pending"
  $relative = Send-FtpFile $file
  if ($relative) {
    $uploaded += 1
    Write-Output "Uploaded: $relative"
  }
}

Write-Output "Deployment frontend selesai: $uploaded file diunggah."
