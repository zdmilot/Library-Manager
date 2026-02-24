using System;
using System.Runtime.InteropServices;

namespace ExampleComHelper
{
    /// <summary>
    /// COM-visible calculator class for testing COM registration with
    /// the Library Manager.
    ///
    /// ProgId: ExampleComHelper.Calculator
    ///
    /// Usage from COM / scripting:
    ///   Set calc = CreateObject("ExampleComHelper.Calculator")
    ///   result = calc.Add(10, 5)        ' → 15
    ///   result = calc.Multiply(3, 7)    ' → 21
    ///   msg    = calc.Greet("Hamilton") ' → "Hello, Hamilton! ..."
    /// </summary>
    [ComVisible(true)]
    [Guid("F1A2B3C4-D5E6-4F78-9A0B-C1D2E3F40002")]
    [ClassInterface(ClassInterfaceType.None)]
    [ProgId("ExampleComHelper.Calculator")]
    public class ExampleComHelperClass : IExampleComHelper
    {
        private string _lastError = string.Empty;

        // --- Arithmetic ---

        public double Add(double a, double b)
        {
            return a + b;
        }

        public double Subtract(double a, double b)
        {
            return a - b;
        }

        public double Multiply(double a, double b)
        {
            return a * b;
        }

        public double Divide(double a, double b)
        {
            if (Math.Abs(b) < double.Epsilon)
            {
                _lastError = "Division by zero";
                return 0;
            }
            _lastError = string.Empty;
            return a / b;
        }

        // --- String Operations ---

        public string Concat(string a, string b)
        {
            return (a ?? string.Empty) + (b ?? string.Empty);
        }

        public string Reverse(string input)
        {
            if (string.IsNullOrEmpty(input)) return string.Empty;
            char[] chars = input.ToCharArray();
            Array.Reverse(chars);
            return new string(chars);
        }

        public int StringLength(string input)
        {
            return input?.Length ?? 0;
        }

        public string Greet(string name)
        {
            if (string.IsNullOrWhiteSpace(name))
                return "Hello! This is ExampleComHelper v" + Version;
            return "Hello, " + name + "! This is ExampleComHelper v" + Version;
        }

        // --- Properties ---

        public string LastError => _lastError;

        public string Version => "1.0.0";
    }
}
