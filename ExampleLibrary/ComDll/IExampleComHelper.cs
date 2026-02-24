using System;
using System.Runtime.InteropServices;

namespace ExampleComHelper
{
    /// <summary>
    /// COM-visible interface for the ExampleComHelper calculator.
    /// Dual interface for both early-binding and late-binding (IDispatch) clients.
    /// </summary>
    [ComVisible(true)]
    [Guid("F1A2B3C4-D5E6-4F78-9A0B-C1D2E3F40001")]
    [InterfaceType(ComInterfaceType.InterfaceIsDual)]
    public interface IExampleComHelper
    {
        /// <summary>Add two numbers.</summary>
        [DispId(1)]
        double Add(double a, double b);

        /// <summary>Subtract b from a.</summary>
        [DispId(2)]
        double Subtract(double a, double b);

        /// <summary>Multiply two numbers.</summary>
        [DispId(3)]
        double Multiply(double a, double b);

        /// <summary>Divide a by b. Returns 0 if b is zero.</summary>
        [DispId(4)]
        double Divide(double a, double b);

        /// <summary>Concatenate two strings.</summary>
        [DispId(5)]
        string Concat(string a, string b);

        /// <summary>Reverse a string.</summary>
        [DispId(6)]
        string Reverse(string input);

        /// <summary>Return the length of a string.</summary>
        [DispId(7)]
        int StringLength(string input);

        /// <summary>Get a greeting message with the caller's name.</summary>
        [DispId(8)]
        string Greet(string name);

        /// <summary>Get the last error message, if any.</summary>
        [DispId(9)]
        string LastError { get; }

        /// <summary>Get the library version string.</summary>
        [DispId(10)]
        string Version { get; }
    }
}
