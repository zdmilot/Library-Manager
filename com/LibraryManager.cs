// SPDX-License-Identifier: Apache-2.0
// ============================================================================
// VenusLibraryManager COM Object  v1.6.5
//
// Copyright (c) 2026 Zachary Milot
// Author: Zachary Milot
//
// COM-visible .NET class library that provides 1:1 parity with the CLI and
// REST API for managing Hamilton VENUS 6 libraries.  This object communicates
// with the REST API server on localhost.
//
// Registration (32-bit ONLY — VENUS is x86):
//   C:\Windows\Microsoft.NET\Framework\v4.0.30319\RegAsm.exe /codebase VenusLibraryManager.dll
//
// Deregistration:
//   C:\Windows\Microsoft.NET\Framework\v4.0.30319\RegAsm.exe /unregister VenusLibraryManager.dll
//
// Usage from VBScript / HSL:
//   Set mgr = CreateObject("VenusLibraryManager.LibraryManager")
//   WScript.Echo mgr.ListLibraries()
//
// Usage from C# / .NET:
//   Type t = Type.GetTypeFromProgID("VenusLibraryManager.LibraryManager");
//   dynamic mgr = Activator.CreateInstance(t);
//   string json = mgr.ListLibraries();
// ============================================================================

using System;
using System.IO;
using System.Net;
using System.Text;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Diagnostics;
using System.Threading;

[assembly: AssemblyTitle("VenusLibraryManager")]
[assembly: AssemblyDescription("COM object for Library Manager for Venus 6")]
[assembly: AssemblyCompany("Zachary Milot")]
[assembly: AssemblyProduct("Library Manager for Venus 6")]
[assembly: AssemblyCopyright("Copyright (c) 2026 Zachary Milot")]
[assembly: AssemblyVersion("1.6.5.0")]
[assembly: AssemblyFileVersion("1.6.5.0")]
[assembly: ComVisible(true)]
[assembly: Guid("B3E7F8A1-4C2D-4E6F-9A1B-3D5E7F9A1B3D")]

namespace VenusLibraryManager
{
    // ======================================================================
    // COM Interface — defines the public contract visible to COM clients
    // ======================================================================
    [Guid("C4F8A9B2-5D3E-4F70-AB2C-4E6F8A0B2C4E")]
    [ComVisible(true)]
    [InterfaceType(ComInterfaceType.InterfaceIsDual)]
    public interface ILibraryManager
    {
        // -- Server Management --
        [DispId(1)]  string StartServer(int port);
        [DispId(2)]  string StopServer();
        [DispId(3)]  bool   IsServerRunning();
        [DispId(4)]  string GetServerUrl();

        // -- Libraries --
        [DispId(10)] string ListLibraries();
        [DispId(11)] string ListLibrariesIncludeDeleted();
        [DispId(12)] string GetLibrary(string nameOrId);
        [DispId(13)] string ImportLibrary(string packagePath);
        [DispId(14)] string ImportLibraryEx(string packagePath, bool force, bool noGroup, bool noCache, string authorPassword, bool requireTrust);
        [DispId(15)] string ImportArchive(string archivePath);
        [DispId(16)] string ImportArchiveEx(string archivePath, bool force, bool noGroup, bool noCache, string authorPassword);
        [DispId(17)] string ExportLibrary(string nameOrId, string outputPath);
        [DispId(18)] string ExportArchiveAll(string outputPath);
        [DispId(19)] string ExportArchiveByNames(string namesJson, string outputPath);
        [DispId(20)] string DeleteLibrary(string nameOrId);
        [DispId(21)] string DeleteLibraryEx(string nameOrId, bool hard, bool keepFiles);

        // -- Packages --
        [DispId(30)] string CreatePackage(string specPath, string outputPath);
        [DispId(31)] string CreatePackageEx(string specPath, string outputPath, string signKeyPath, string signCertPath, string authorPassword);
        [DispId(32)] string VerifyPackage(string packagePath);

        // -- Versions --
        [DispId(40)] string ListVersions(string libraryName);
        [DispId(41)] string RollbackLibrary(string libraryName, string version);
        [DispId(42)] string RollbackLibraryByIndex(string libraryName, int index);

        // -- Publishers --
        [DispId(50)] string ListPublishers();
        [DispId(51)] string GenerateKeypair(string publisher, string organization, string outputDir);

        // -- System Libraries --
        [DispId(60)] string GetSystemLibraries();
        [DispId(61)] string VerifySyslibHashes();
        [DispId(62)] string GenerateSyslibHashes(string sourceDir, string outputPath);

        // -- Audit & Settings --
        [DispId(70)] string GetAuditTrail();
        [DispId(71)] string GetAuditTrailLast(int count);
        [DispId(72)] string GetSettings();

        // -- Health --
        [DispId(80)] string HealthCheck();

        // -- Configuration --
        [DispId(90)] int    Port { get; set; }
        [DispId(91)] string ApiKey { get; set; }
        [DispId(92)] string LastError { get; }
    }

    // ======================================================================
    // COM Events Interface
    // ======================================================================
    [Guid("D5A9BAC3-6E4F-4081-BC3D-5F70AB1C3D5F")]
    [ComVisible(true)]
    [InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    public interface ILibraryManagerEvents
    {
        [DispId(100)] void ServerStarted(string url);
        [DispId(101)] void ServerStopped();
        [DispId(102)] void OperationCompleted(string operation, bool success, string resultJson);
        [DispId(103)] void ErrorOccurred(string operation, string errorMessage);
    }

    // ======================================================================
    // COM Class — the main coclass
    // ======================================================================
    [Guid("A2D6E8F0-3B1C-4D5E-8F0A-2C4D6E8F0A2C")]
    [ComVisible(true)]
    [ClassInterface(ClassInterfaceType.None)]
    [ComDefaultInterface(typeof(ILibraryManager))]
    [ComSourceInterfaces(typeof(ILibraryManagerEvents))]
    [ProgId("VenusLibraryManager.LibraryManager")]
    public class LibraryManager : ILibraryManager
    {
        // -- Private state --
        private int    _port     = 5555;
        private string _apiKey   = null;
        private string _lastError = "";
        private Process _serverProcess = null;
        private string _appDir   = null;

        // -- Events --
        public delegate void ServerStartedHandler(string url);
        public delegate void ServerStoppedHandler();
        public delegate void OperationCompletedHandler(string operation, bool success, string resultJson);
        public delegate void ErrorOccurredHandler(string operation, string errorMessage);

        public event ServerStartedHandler ServerStarted;
        public event ServerStoppedHandler ServerStopped;
        public event OperationCompletedHandler OperationCompleted;
        public event ErrorOccurredHandler ErrorOccurred;

        // ================================================================
        // Constructor
        // ================================================================
        public LibraryManager()
        {
            // Resolve application directory from where the DLL is installed
            _appDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        }

        // ================================================================
        // Properties
        // ================================================================
        public int Port
        {
            get { return _port; }
            set { _port = value; }
        }

        public string ApiKey
        {
            get { return _apiKey; }
            set { _apiKey = value; }
        }

        public string LastError
        {
            get { return _lastError; }
        }

        // ================================================================
        // Server Management
        // ================================================================

        /// <summary>
        /// Start the REST API server as a background node process.
        /// Returns the server URL on success.
        /// </summary>
        public string StartServer(int port)
        {
            try
            {
                if (_serverProcess != null && !_serverProcess.HasExited)
                {
                    return MakeResult(true, "Server already running at http://127.0.0.1:" + _port);
                }

                _port = port > 0 ? port : _port;

                // Find node.exe — check app dir first, then PATH
                string nodeExe = FindNodeExecutable();
                if (nodeExe == null)
                {
                    _lastError = "Cannot find node.exe. Ensure Node.js is installed or the NW.js runtime is available.";
                    RaiseError("StartServer", _lastError);
                    return MakeError(_lastError);
                }

                string restApiScript = Path.Combine(_appDir, "rest-api.js");
                if (!File.Exists(restApiScript))
                {
                    _lastError = "rest-api.js not found at: " + restApiScript;
                    RaiseError("StartServer", _lastError);
                    return MakeError(_lastError);
                }

                var psi = new ProcessStartInfo
                {
                    FileName               = nodeExe,
                    Arguments              = "\"" + restApiScript + "\" --port " + _port + (!string.IsNullOrEmpty(_apiKey) ? " --api-key " + _apiKey : ""),
                    WorkingDirectory       = _appDir,
                    UseShellExecute        = false,
                    CreateNoWindow         = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError  = true
                };

                _serverProcess = Process.Start(psi);

                // Brief wait for server to start listening
                Thread.Sleep(1500);

                if (_serverProcess.HasExited)
                {
                    string stderr = _serverProcess.StandardError.ReadToEnd();
                    _lastError = "Server failed to start: " + stderr;
                    _serverProcess = null;
                    RaiseError("StartServer", _lastError);
                    return MakeError(_lastError);
                }

                string url = "http://127.0.0.1:" + _port;
                if (ServerStarted != null) ServerStarted(url);
                return MakeResult(true, url);
            }
            catch (Exception ex)
            {
                _lastError = ex.Message;
                RaiseError("StartServer", _lastError);
                return MakeError(_lastError);
            }
        }

        /// <summary>
        /// Stop the REST API server background process.
        /// </summary>
        public string StopServer()
        {
            try
            {
                if (_serverProcess == null || _serverProcess.HasExited)
                {
                    _serverProcess = null;
                    if (ServerStopped != null) ServerStopped();
                    return MakeResult(true, "Server was not running");
                }

                _serverProcess.Kill();
                _serverProcess.WaitForExit(5000);
                _serverProcess = null;

                if (ServerStopped != null) ServerStopped();
                return MakeResult(true, "Server stopped");
            }
            catch (Exception ex)
            {
                _lastError = ex.Message;
                RaiseError("StopServer", _lastError);
                return MakeError(_lastError);
            }
        }

        public bool IsServerRunning()
        {
            return _serverProcess != null && !_serverProcess.HasExited;
        }

        public string GetServerUrl()
        {
            return "http://127.0.0.1:" + _port;
        }

        // ================================================================
        // Library Operations
        // ================================================================

        public string ListLibraries()
        {
            return HttpGet("/api/libraries");
        }

        public string ListLibrariesIncludeDeleted()
        {
            return HttpGet("/api/libraries?includeDeleted=true");
        }

        public string GetLibrary(string nameOrId)
        {
            return HttpGet("/api/libraries/" + Uri.EscapeDataString(nameOrId));
        }

        public string ImportLibrary(string packagePath)
        {
            return ImportLibraryEx(packagePath, false, false, false, null, false);
        }

        public string ImportLibraryEx(string packagePath, bool force, bool noGroup, bool noCache, string authorPassword, bool requireTrust)
        {
            return HttpUpload("/api/libraries/import", "package", packagePath,
                new string[] {
                    "force", force.ToString().ToLower(),
                    "noGroup", noGroup.ToString().ToLower(),
                    "noCache", noCache.ToString().ToLower(),
                    "authorPassword", authorPassword ?? "",
                    "requireTrust", requireTrust.ToString().ToLower()
                });
        }

        public string ImportArchive(string archivePath)
        {
            return ImportArchiveEx(archivePath, false, false, false, null);
        }

        public string ImportArchiveEx(string archivePath, bool force, bool noGroup, bool noCache, string authorPassword)
        {
            return HttpUpload("/api/libraries/import-archive", "archive", archivePath,
                new string[] {
                    "force", force.ToString().ToLower(),
                    "noGroup", noGroup.ToString().ToLower(),
                    "noCache", noCache.ToString().ToLower(),
                    "authorPassword", authorPassword ?? ""
                });
        }

        public string ExportLibrary(string nameOrId, string outputPath)
        {
            return HttpDownload("/api/libraries/" + Uri.EscapeDataString(nameOrId) + "/export", outputPath);
        }

        public string ExportArchiveAll(string outputPath)
        {
            string body = "{\"all\":true}";
            return HttpDownloadPost("/api/libraries/export-archive", body, outputPath);
        }

        public string ExportArchiveByNames(string namesJson, string outputPath)
        {
            // namesJson should be a JSON array: ["MyLib1","MyLib2"]
            string body = "{\"names\":" + namesJson + "}";
            return HttpDownloadPost("/api/libraries/export-archive", body, outputPath);
        }

        public string DeleteLibrary(string nameOrId)
        {
            return DeleteLibraryEx(nameOrId, false, false);
        }

        public string DeleteLibraryEx(string nameOrId, bool hard, bool keepFiles)
        {
            string body = "{\"hard\":" + hard.ToString().ToLower() + ",\"keepFiles\":" + keepFiles.ToString().ToLower() + "}";
            return HttpRequest("DELETE", "/api/libraries/" + Uri.EscapeDataString(nameOrId), body);
        }

        // ================================================================
        // Package Operations
        // ================================================================

        public string CreatePackage(string specPath, string outputPath)
        {
            return CreatePackageEx(specPath, outputPath, null, null, null);
        }

        public string CreatePackageEx(string specPath, string outputPath, string signKeyPath, string signCertPath, string authorPassword)
        {
            string body = "{\"specPath\":" + JsonEscape(specPath)
                        + ",\"output\":" + JsonEscape(outputPath);
            if (!string.IsNullOrEmpty(signKeyPath))
                body += ",\"signKey\":" + JsonEscape(signKeyPath);
            if (!string.IsNullOrEmpty(signCertPath))
                body += ",\"signCert\":" + JsonEscape(signCertPath);
            if (!string.IsNullOrEmpty(authorPassword))
                body += ",\"authorPassword\":" + JsonEscape(authorPassword);
            body += "}";
            return HttpPost("/api/packages/create", body);
        }

        public string VerifyPackage(string packagePath)
        {
            return HttpUpload("/api/packages/verify", "package", packagePath, new string[0]);
        }

        // ================================================================
        // Version Operations
        // ================================================================

        public string ListVersions(string libraryName)
        {
            return HttpGet("/api/libraries/" + Uri.EscapeDataString(libraryName) + "/versions");
        }

        public string RollbackLibrary(string libraryName, string version)
        {
            string body = "{\"version\":" + JsonEscape(version) + "}";
            return HttpPost("/api/libraries/" + Uri.EscapeDataString(libraryName) + "/rollback", body);
        }

        public string RollbackLibraryByIndex(string libraryName, int index)
        {
            string body = "{\"index\":" + index + "}";
            return HttpPost("/api/libraries/" + Uri.EscapeDataString(libraryName) + "/rollback", body);
        }

        // ================================================================
        // Publisher Operations
        // ================================================================

        public string ListPublishers()
        {
            return HttpGet("/api/publishers");
        }

        public string GenerateKeypair(string publisher, string organization, string outputDir)
        {
            string body = "{\"publisher\":" + JsonEscape(publisher)
                        + ",\"organization\":" + JsonEscape(organization)
                        + ",\"outputDir\":" + JsonEscape(outputDir) + "}";
            return HttpPost("/api/publishers/generate-keypair", body);
        }

        // ================================================================
        // System Library Operations
        // ================================================================

        public string GetSystemLibraries()
        {
            return HttpGet("/api/system-libraries");
        }

        public string VerifySyslibHashes()
        {
            return HttpGet("/api/system-libraries/verify");
        }

        public string GenerateSyslibHashes(string sourceDir, string outputPath)
        {
            string body = "{\"sourceDir\":" + JsonEscape(sourceDir)
                        + ",\"output\":" + JsonEscape(outputPath) + "}";
            return HttpPost("/api/system-libraries/generate-hashes", body);
        }

        // ================================================================
        // Audit & Settings
        // ================================================================

        public string GetAuditTrail()
        {
            return HttpGet("/api/audit");
        }

        public string GetAuditTrailLast(int count)
        {
            return HttpGet("/api/audit?limit=" + count);
        }

        public string GetSettings()
        {
            return HttpGet("/api/settings");
        }

        // ================================================================
        // Health
        // ================================================================

        public string HealthCheck()
        {
            return HttpGet("/api/health");
        }

        // ================================================================
        // Private HTTP Helpers
        // ================================================================

        private string HttpGet(string path)
        {
            return HttpRequest("GET", path, null);
        }

        private string HttpPost(string path, string jsonBody)
        {
            return HttpRequest("POST", path, jsonBody);
        }

        private string HttpRequest(string method, string path, string body)
        {
            try
            {
                EnsureServerRunning();
                string url = "http://127.0.0.1:" + _port + path;
                var request = (HttpWebRequest)WebRequest.Create(url);
                request.Method = method;
                request.Timeout = 300000; // 5 minutes for long operations
                request.ContentType = "application/json";

                if (!string.IsNullOrEmpty(_apiKey))
                    request.Headers.Add("X-API-Key", _apiKey);

                if (!string.IsNullOrEmpty(body))
                {
                    byte[] bodyBytes = Encoding.UTF8.GetBytes(body);
                    request.ContentLength = bodyBytes.Length;
                    using (var stream = request.GetRequestStream())
                    {
                        stream.Write(bodyBytes, 0, bodyBytes.Length);
                    }
                }

                using (var response = (HttpWebResponse)request.GetResponse())
                using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                {
                    string result = reader.ReadToEnd();
                    RaiseCompleted(method + " " + path, true, result);
                    return result;
                }
            }
            catch (WebException wex)
            {
                string errorBody = "";
                if (wex.Response != null)
                {
                    using (var reader = new StreamReader(wex.Response.GetResponseStream(), Encoding.UTF8))
                    {
                        errorBody = reader.ReadToEnd();
                    }
                }
                _lastError = string.IsNullOrEmpty(errorBody) ? wex.Message : errorBody;
                RaiseError(method + " " + path, _lastError);
                return _lastError;
            }
            catch (Exception ex)
            {
                _lastError = ex.Message;
                RaiseError(method + " " + path, _lastError);
                return MakeError(_lastError);
            }
        }

        private string HttpUpload(string path, string fieldName, string filePath, string[] formFields)
        {
            try
            {
                EnsureServerRunning();

                if (!File.Exists(filePath))
                {
                    _lastError = "File not found: " + filePath;
                    RaiseError("Upload " + path, _lastError);
                    return MakeError(_lastError);
                }

                string url = "http://127.0.0.1:" + _port + path;
                string boundary = "----VenusLibMgr" + DateTime.Now.Ticks.ToString("x");
                var request = (HttpWebRequest)WebRequest.Create(url);
                request.Method = "POST";
                request.ContentType = "multipart/form-data; boundary=" + boundary;
                request.Timeout = 300000;

                if (!string.IsNullOrEmpty(_apiKey))
                    request.Headers.Add("X-API-Key", _apiKey);

                using (var reqStream = request.GetRequestStream())
                {
                    // Write form fields
                    for (int i = 0; i < formFields.Length; i += 2)
                    {
                        string fld = "--" + boundary + "\r\n"
                                   + "Content-Disposition: form-data; name=\"" + formFields[i] + "\"\r\n\r\n"
                                   + formFields[i + 1] + "\r\n";
                        byte[] fldBytes = Encoding.UTF8.GetBytes(fld);
                        reqStream.Write(fldBytes, 0, fldBytes.Length);
                    }

                    // Write file
                    string fileName = Path.GetFileName(filePath);
                    string fileHeader = "--" + boundary + "\r\n"
                                      + "Content-Disposition: form-data; name=\"" + fieldName + "\"; filename=\"" + fileName + "\"\r\n"
                                      + "Content-Type: application/octet-stream\r\n\r\n";
                    byte[] headerBytes = Encoding.UTF8.GetBytes(fileHeader);
                    reqStream.Write(headerBytes, 0, headerBytes.Length);

                    using (var fileStream = File.OpenRead(filePath))
                    {
                        byte[] buffer = new byte[65536];
                        int bytesRead;
                        while ((bytesRead = fileStream.Read(buffer, 0, buffer.Length)) > 0)
                        {
                            reqStream.Write(buffer, 0, bytesRead);
                        }
                    }

                    string footer = "\r\n--" + boundary + "--\r\n";
                    byte[] footerBytes = Encoding.UTF8.GetBytes(footer);
                    reqStream.Write(footerBytes, 0, footerBytes.Length);
                }

                using (var response = (HttpWebResponse)request.GetResponse())
                using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                {
                    string result = reader.ReadToEnd();
                    RaiseCompleted("Upload " + path, true, result);
                    return result;
                }
            }
            catch (WebException wex)
            {
                string errorBody = "";
                if (wex.Response != null)
                {
                    using (var reader = new StreamReader(wex.Response.GetResponseStream(), Encoding.UTF8))
                    {
                        errorBody = reader.ReadToEnd();
                    }
                }
                _lastError = string.IsNullOrEmpty(errorBody) ? wex.Message : errorBody;
                RaiseError("Upload " + path, _lastError);
                return _lastError;
            }
            catch (Exception ex)
            {
                _lastError = ex.Message;
                RaiseError("Upload " + path, _lastError);
                return MakeError(_lastError);
            }
        }

        private string HttpDownload(string path, string outputPath)
        {
            try
            {
                EnsureServerRunning();
                string url = "http://127.0.0.1:" + _port + path;
                var request = (HttpWebRequest)WebRequest.Create(url);
                request.Method = "GET";
                request.Timeout = 300000;

                if (!string.IsNullOrEmpty(_apiKey))
                    request.Headers.Add("X-API-Key", _apiKey);

                using (var response = (HttpWebResponse)request.GetResponse())
                {
                    if (response.ContentType != null && response.ContentType.Contains("application/json"))
                    {
                        using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                        {
                            string errorJson = reader.ReadToEnd();
                            _lastError = errorJson;
                            return errorJson;
                        }
                    }

                    string dir = Path.GetDirectoryName(outputPath);
                    if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                        Directory.CreateDirectory(dir);

                    using (var fileStream = File.Create(outputPath))
                    using (var responseStream = response.GetResponseStream())
                    {
                        byte[] buffer = new byte[65536];
                        int bytesRead;
                        while ((bytesRead = responseStream.Read(buffer, 0, buffer.Length)) > 0)
                        {
                            fileStream.Write(buffer, 0, bytesRead);
                        }
                    }

                    string result = MakeResult(true, "Exported to " + outputPath);
                    RaiseCompleted("Download " + path, true, result);
                    return result;
                }
            }
            catch (WebException wex)
            {
                string errorBody = "";
                if (wex.Response != null)
                {
                    using (var reader = new StreamReader(wex.Response.GetResponseStream(), Encoding.UTF8))
                    {
                        errorBody = reader.ReadToEnd();
                    }
                }
                _lastError = string.IsNullOrEmpty(errorBody) ? wex.Message : errorBody;
                RaiseError("Download " + path, _lastError);
                return _lastError;
            }
            catch (Exception ex)
            {
                _lastError = ex.Message;
                RaiseError("Download " + path, _lastError);
                return MakeError(_lastError);
            }
        }

        private string HttpDownloadPost(string path, string body, string outputPath)
        {
            try
            {
                EnsureServerRunning();
                string url = "http://127.0.0.1:" + _port + path;
                var request = (HttpWebRequest)WebRequest.Create(url);
                request.Method = "POST";
                request.ContentType = "application/json";
                request.Timeout = 300000;

                if (!string.IsNullOrEmpty(_apiKey))
                    request.Headers.Add("X-API-Key", _apiKey);

                byte[] bodyBytes = Encoding.UTF8.GetBytes(body);
                request.ContentLength = bodyBytes.Length;
                using (var stream = request.GetRequestStream())
                {
                    stream.Write(bodyBytes, 0, bodyBytes.Length);
                }

                using (var response = (HttpWebResponse)request.GetResponse())
                {
                    if (response.ContentType != null && response.ContentType.Contains("application/json"))
                    {
                        using (var reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                        {
                            string errorJson = reader.ReadToEnd();
                            _lastError = errorJson;
                            return errorJson;
                        }
                    }

                    string dir = Path.GetDirectoryName(outputPath);
                    if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                        Directory.CreateDirectory(dir);

                    using (var fileStream = File.Create(outputPath))
                    using (var responseStream = response.GetResponseStream())
                    {
                        byte[] buffer = new byte[65536];
                        int bytesRead;
                        while ((bytesRead = responseStream.Read(buffer, 0, buffer.Length)) > 0)
                        {
                            fileStream.Write(buffer, 0, bytesRead);
                        }
                    }

                    string result = MakeResult(true, "Exported to " + outputPath);
                    RaiseCompleted("DownloadPost " + path, true, result);
                    return result;
                }
            }
            catch (WebException wex)
            {
                string errorBody = "";
                if (wex.Response != null)
                {
                    using (var reader = new StreamReader(wex.Response.GetResponseStream(), Encoding.UTF8))
                    {
                        errorBody = reader.ReadToEnd();
                    }
                }
                _lastError = string.IsNullOrEmpty(errorBody) ? wex.Message : errorBody;
                RaiseError("DownloadPost " + path, _lastError);
                return _lastError;
            }
            catch (Exception ex)
            {
                _lastError = ex.Message;
                RaiseError("DownloadPost " + path, _lastError);
                return MakeError(_lastError);
            }
        }

        // ================================================================
        // Private Helpers
        // ================================================================

        private void EnsureServerRunning()
        {
            if (_serverProcess == null || _serverProcess.HasExited)
            {
                // Auto-start the server
                StartServer(_port);
            }
        }

        private string FindNodeExecutable()
        {
            // Check for nw.exe in app directory (NW.js runtime)
            string nwPath = Path.Combine(_appDir, "nw.exe");
            if (File.Exists(nwPath))
                return nwPath;

            // Check for node.exe in app directory
            string nodePath = Path.Combine(_appDir, "node.exe");
            if (File.Exists(nodePath))
                return nodePath;

            // Check for node.exe in PATH
            string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string dir in pathEnv.Split(';'))
            {
                if (string.IsNullOrWhiteSpace(dir)) continue;
                string candidate = Path.Combine(dir.Trim(), "node.exe");
                if (File.Exists(candidate))
                    return candidate;
            }

            return null;
        }

        private static string JsonEscape(string value)
        {
            if (value == null) return "null";
            return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "\\r") + "\"";
        }

        private static string MakeResult(bool success, string data)
        {
            return "{\"success\":" + success.ToString().ToLower() + ",\"data\":" + JsonEscape(data) + "}";
        }

        private static string MakeError(string message)
        {
            return "{\"success\":false,\"error\":" + JsonEscape(message) + "}";
        }

        private void RaiseCompleted(string operation, bool success, string result)
        {
            if (OperationCompleted != null)
            {
                try { OperationCompleted(operation, success, result); }
                catch { /* swallow event handler errors */ }
            }
        }

        private void RaiseError(string operation, string message)
        {
            if (ErrorOccurred != null)
            {
                try { ErrorOccurred(operation, message); }
                catch { /* swallow event handler errors */ }
            }
        }
    }
}
