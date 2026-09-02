using System.Reflection;

namespace Muamalat.Tests.Workflow;

/// <summary>
/// Writes to a private setter, the way a tamper at the database level or a hand-edited
/// legacy row would. Used only to construct states the public API deliberately refuses to
/// produce, so that the code which has to survive them can be tested at all.
/// </summary>
internal static class TestReflection
{
    public static void ForceSet<T>(T target, string propertyName, object? value) where T : class =>
        typeof(T)
            .GetProperty(propertyName, BindingFlags.Public | BindingFlags.Instance)!
            .SetValue(target, value);
}
