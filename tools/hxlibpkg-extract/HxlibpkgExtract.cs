/*
 * HxlibpkgExtract.cs  -  Portable extraction tool for .hxlibpkg / .hxlibarch
 *
 * Standalone Windows console application that extracts Hamilton VENUS Library
 * Manager packages without requiring the full Library Manager application or
 * Node.js.  Compiled with the .NET Framework 4.x C# compiler (csc.exe) that
 * ships with every Windows 10+ installation.
 *
 * Build (run from this directory or adjust paths):
 *   C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe /out:hxlibpkg-extract.exe /target:exe HxlibpkgExtract.cs
 *
 * Usage:
 *   hxlibpkg-extract.exe <package> [--out <dir>] [--list] [--manifest]
 */

using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;

namespace HxlibpkgExtract
{
    class Program
    {
        // Binary container constants (must match lib/shared.js)
        static readonly string PKG_SIGNING_KEY = "VenusLibMgr::PackageIntegrity::a7e3f9d1c6b2";

        static readonly byte[] CONTAINER_MAGIC_PKG = { 0x48, 0x58, 0x4C, 0x50, 0x4B, 0x47, 0x01, 0x00 };
        static readonly byte[] CONTAINER_MAGIC_ARC = { 0x48, 0x58, 0x4C, 0x41, 0x52, 0x43, 0x01, 0x00 };

        static readonly byte[] CONTAINER_SCRAMBLE_KEY = {
            0x7A, 0x3F, 0xC1, 0xD8, 0x4E, 0x92, 0xB5, 0x16,
            0xA3, 0x0D, 0xE7, 0x68, 0xF4, 0x2C, 0x59, 0x8B,
            0x31, 0xCA, 0x75, 0x0E, 0x96, 0xAF, 0xD2, 0x43,
            0xBC, 0x1A, 0x67, 0xE0, 0x58, 0x84, 0x3B, 0xF9
        };

        const int CONTAINER_HEADER_SIZE = 48;

        static int Main(string[] args)
        {
            if (args.Length == 0 || Array.IndexOf(args, "--help") >= 0)
            {
                PrintUsage();
                return args.Length == 0 ? 1 : 0;
            }

            string packagePath = null;
            string outDir = null;
            bool listOnly = false;
            bool manifestOnly = false;

            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--out" && i + 1 < args.Length)
                    outDir = args[++i];
                else if (args[i] == "--list")
                    listOnly = true;
                else if (args[i] == "--manifest")
                    manifestOnly = true;
                else if (packagePath == null && !args[i].StartsWith("--"))
                    packagePath = args[i];
            }

            if (packagePath == null)
            {
                Console.Error.WriteLine("Error: no package file specified.");
                PrintUsage();
                return 1;
            }

            if (!File.Exists(packagePath))
            {
                Console.Error.WriteLine("Error: file not found: " + packagePath);
                return 1;
            }

            try
            {
                byte[] rawBuffer = File.ReadAllBytes(packagePath);

                byte[] zipBuffer;
                bool isArchive = false;

                try
                {
                    zipBuffer = UnpackContainer(rawBuffer, CONTAINER_MAGIC_PKG);
                }
                catch
                {
                    try
                    {
                        zipBuffer = UnpackContainer(rawBuffer, CONTAINER_MAGIC_ARC);
                        isArchive = true;
                    }
                    catch (Exception ex)
                    {
                        Console.Error.WriteLine("Error: " + ex.Message);
                        return 1;
                    }
                }

                if (isArchive)
                    return HandleArchive(zipBuffer, packagePath, outDir, listOnly, manifestOnly);
                else
                    return HandlePackage(zipBuffer, packagePath, outDir, listOnly, manifestOnly);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("Error: " + ex.Message);
                return 1;
            }
        }

        static void PrintUsage()
        {
            Console.WriteLine("hxlibpkg-extract - Portable extraction tool for Library Manager packages");
            Console.WriteLine();
            Console.WriteLine("Usage: hxlibpkg-extract.exe <package> [options]");
            Console.WriteLine();
            Console.WriteLine("Options:");
            Console.WriteLine("  --out <dir>   Output directory (default: ./<library_name>)");
            Console.WriteLine("  --list        List package contents without extracting");
            Console.WriteLine("  --manifest    Print manifest.json and exit");
            Console.WriteLine("  --help        Show this help message");
            Console.WriteLine();
            Console.WriteLine("Supports .hxlibpkg (single library) and .hxlibarch (multi-library archive).");
        }

        static byte[] UnpackContainer(byte[] containerBuffer, byte[] magic)
        {
            if (containerBuffer == null || containerBuffer.Length < CONTAINER_HEADER_SIZE)
                throw new InvalidDataException("Invalid package: file is too small or not a valid container.");

            for (int i = 0; i < magic.Length; i++)
            {
                if (containerBuffer[i] != magic[i])
                    throw new InvalidDataException("Invalid package: unrecognized file format.");
            }

            uint payloadLen = BitConverter.ToUInt32(containerBuffer, 12);
            if (containerBuffer.Length < CONTAINER_HEADER_SIZE + payloadLen)
                throw new InvalidDataException("Invalid package: file is truncated or corrupted.");

            byte[] storedHmac = new byte[32];
            Array.Copy(containerBuffer, 16, storedHmac, 0, 32);

            byte[] scrambled = new byte[payloadLen];
            Array.Copy(containerBuffer, CONTAINER_HEADER_SIZE, scrambled, 0, (int)payloadLen);

            // Verify HMAC-SHA256
            using (var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(PKG_SIGNING_KEY)))
            {
                byte[] computedHmac = hmac.ComputeHash(scrambled);
                if (!ConstantTimeEquals(storedHmac, computedHmac))
                    throw new InvalidDataException("Package integrity check failed: the file has been corrupted or tampered with.");
            }

            // XOR descramble
            byte[] zipBuffer = new byte[payloadLen];
            for (int i = 0; i < scrambled.Length; i++)
                zipBuffer[i] = (byte)(scrambled[i] ^ CONTAINER_SCRAMBLE_KEY[i % CONTAINER_SCRAMBLE_KEY.Length]);

            return zipBuffer;
        }

        static bool ConstantTimeEquals(byte[] a, byte[] b)
        {
            if (a.Length != b.Length) return false;
            int diff = 0;
            for (int i = 0; i < a.Length; i++)
                diff |= a[i] ^ b[i];
            return diff == 0;
        }

        // --- Single package handling ---

        static int HandlePackage(byte[] zipBuffer, string packagePath, string outDir, bool listOnly, bool manifestOnly)
        {
            using (var ms = new MemoryStream(zipBuffer))
            using (var zip = new ZipArchive(ms, ZipArchiveMode.Read))
            {
                string manifestJson = ReadEntryText(zip, "manifest.json");
                string libName = ExtractJsonField(manifestJson, "library_name")
                                 ?? Path.GetFileNameWithoutExtension(packagePath);

                if (manifestOnly)
                {
                    Console.WriteLine(manifestJson ?? "{}");
                    return 0;
                }

                if (listOnly)
                {
                    string version = ExtractJsonField(manifestJson, "version") ?? "?";
                    Console.WriteLine("Package: " + libName + " v" + version);
                    Console.WriteLine(zip.Entries.Count + " entries:");
                    foreach (var entry in zip.Entries)
                    {
                        if (!string.IsNullOrEmpty(entry.Name))
                            Console.WriteLine("  " + entry.FullName + "  (" + entry.Length + " bytes)");
                    }
                    return 0;
                }

                string targetDir = outDir ?? SanitizeFileName(libName);
                int extracted = ExtractPackageZip(zip, manifestJson, targetDir);
                Console.WriteLine("Extracted \"" + libName + "\" (" + extracted + " files) -> " + Path.GetFullPath(targetDir));

                string installerExe = ExtractJsonField(manifestJson, "installer_executable");
                if (!string.IsNullOrEmpty(installerExe))
                    Console.WriteLine("  Installer: " + installerExe);
            }

            return 0;
        }

        // --- Archive handling ---

        static int HandleArchive(byte[] zipBuffer, string packagePath, string outDir, bool listOnly, bool manifestOnly)
        {
            using (var ms = new MemoryStream(zipBuffer))
            using (var zip = new ZipArchive(ms, ZipArchiveMode.Read))
            {
                if (manifestOnly)
                {
                    string archManifest = ReadEntryText(zip, "manifest.json");
                    Console.WriteLine(archManifest ?? "{}");
                    return 0;
                }

                // Find inner .hxlibpkg entries
                var pkgEntries = new List<ZipArchiveEntry>();
                foreach (var entry in zip.Entries)
                {
                    if (entry.FullName.EndsWith(".hxlibpkg", StringComparison.OrdinalIgnoreCase))
                        pkgEntries.Add(entry);
                }

                Console.WriteLine("Archive contains " + pkgEntries.Count + " package(s):");
                foreach (var pe in pkgEntries)
                    Console.WriteLine("  " + pe.FullName);

                if (listOnly)
                    return 0;

                string baseOutDir = outDir ?? Path.GetFileNameWithoutExtension(packagePath);

                foreach (var pe in pkgEntries)
                {
                    try
                    {
                        byte[] innerRaw;
                        using (var entryStream = pe.Open())
                        using (var buf = new MemoryStream())
                        {
                            entryStream.CopyTo(buf);
                            innerRaw = buf.ToArray();
                        }

                        byte[] innerZipBuffer = UnpackContainer(innerRaw, CONTAINER_MAGIC_PKG);

                        using (var innerMs = new MemoryStream(innerZipBuffer))
                        using (var innerZip = new ZipArchive(innerMs, ZipArchiveMode.Read))
                        {
                            string innerManifest = ReadEntryText(innerZip, "manifest.json");
                            string innerLibName = ExtractJsonField(innerManifest, "library_name")
                                                  ?? Path.GetFileNameWithoutExtension(pe.FullName);
                            string libOutDir = Path.Combine(baseOutDir, SanitizeFileName(innerLibName));
                            int count = ExtractPackageZip(innerZip, innerManifest, libOutDir);
                            Console.WriteLine("Extracted \"" + innerLibName + "\" (" + count + " files) -> " + Path.GetFullPath(libOutDir));
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.Error.WriteLine("  Error extracting " + pe.FullName + ": " + ex.Message);
                    }
                }
            }

            return 0;
        }

        // --- Extraction ---

        static int ExtractPackageZip(ZipArchive zip, string manifestJson, string targetDir)
        {
            int extracted = 0;

            foreach (var entry in zip.Entries)
            {
                if (string.IsNullOrEmpty(entry.Name)) continue; // skip directories
                if (entry.FullName == "manifest.json" || entry.FullName == "signature.json") continue;

                string destDir = targetDir;
                string relName = entry.FullName;

                if (entry.FullName.StartsWith("library/", StringComparison.OrdinalIgnoreCase))
                {
                    destDir = Path.Combine(targetDir, "library");
                    relName = entry.FullName.Substring("library/".Length);
                }
                else if (entry.FullName.StartsWith("demo_methods/", StringComparison.OrdinalIgnoreCase))
                {
                    destDir = Path.Combine(targetDir, "demo_methods");
                    relName = entry.FullName.Substring("demo_methods/".Length);
                }
                else if (entry.FullName.StartsWith("installer/", StringComparison.OrdinalIgnoreCase))
                {
                    destDir = Path.Combine(targetDir, "installer");
                    relName = entry.FullName.Substring("installer/".Length);
                }
                else if (entry.FullName.StartsWith("icon/", StringComparison.OrdinalIgnoreCase))
                {
                    destDir = Path.Combine(targetDir, "icon");
                    relName = entry.FullName.Substring("icon/".Length);
                }
                else if (entry.FullName.StartsWith("help/", StringComparison.OrdinalIgnoreCase))
                {
                    destDir = Path.Combine(targetDir, "help");
                    relName = entry.FullName.Substring("help/".Length);
                }
                else if (entry.FullName.StartsWith("bin/", StringComparison.OrdinalIgnoreCase))
                {
                    destDir = Path.Combine(targetDir, "bin");
                    relName = entry.FullName.Substring("bin/".Length);
                }

                if (string.IsNullOrEmpty(relName)) continue;

                // Path traversal protection
                string safePath = SafeExtractPath(destDir, relName);
                if (safePath == null)
                {
                    Console.Error.WriteLine("  Skipping unsafe path: " + entry.FullName);
                    continue;
                }

                string parentDir = Path.GetDirectoryName(safePath);
                if (!Directory.Exists(parentDir))
                    Directory.CreateDirectory(parentDir);

                using (var entryStream = entry.Open())
                using (var fileStream = File.Create(safePath))
                {
                    entryStream.CopyTo(fileStream);
                }
                extracted++;
            }

            // Write manifest.json to output
            string manifestText = ReadEntryText(zip, "manifest.json");
            if (manifestText != null)
            {
                if (!Directory.Exists(targetDir))
                    Directory.CreateDirectory(targetDir);
                File.WriteAllText(Path.Combine(targetDir, "manifest.json"), manifestText, Encoding.UTF8);
                extracted++;
            }

            return extracted;
        }

        // --- Path safety ---

        static string SafeExtractPath(string baseDir, string relPath)
        {
            string resolved = Path.GetFullPath(Path.Combine(baseDir, relPath));
            string normalBase = Path.GetFullPath(baseDir);
            if (!normalBase.EndsWith(Path.DirectorySeparatorChar.ToString()))
                normalBase += Path.DirectorySeparatorChar;
            if (!resolved.StartsWith(normalBase) && resolved != Path.GetFullPath(baseDir))
                return null;
            return resolved;
        }

        // --- Helpers ---

        static string ReadEntryText(ZipArchive zip, string entryName)
        {
            var entry = zip.GetEntry(entryName);
            if (entry == null) return null;
            using (var stream = entry.Open())
            using (var reader = new StreamReader(stream, Encoding.UTF8))
            {
                return reader.ReadToEnd();
            }
        }

        /// <summary>
        /// Minimal JSON field extractor - no external JSON library needed.
        /// Extracts the first occurrence of a top-level string field.
        /// </summary>
        static string ExtractJsonField(string json, string fieldName)
        {
            if (string.IsNullOrEmpty(json)) return null;
            string needle = "\"" + fieldName + "\"";
            int idx = json.IndexOf(needle, StringComparison.Ordinal);
            if (idx < 0) return null;
            int colonIdx = json.IndexOf(':', idx + needle.Length);
            if (colonIdx < 0) return null;
            // Find the opening quote of the value
            int openQuote = json.IndexOf('"', colonIdx + 1);
            if (openQuote < 0) return null;
            // Find closing quote (handle escaped quotes)
            int closeQuote = openQuote + 1;
            while (closeQuote < json.Length)
            {
                if (json[closeQuote] == '\\') { closeQuote += 2; continue; }
                if (json[closeQuote] == '"') break;
                closeQuote++;
            }
            if (closeQuote >= json.Length) return null;
            return json.Substring(openQuote + 1, closeQuote - openQuote - 1);
        }

        static string SanitizeFileName(string name)
        {
            foreach (char c in Path.GetInvalidFileNameChars())
                name = name.Replace(c, '_');
            return name;
        }
    }
}
