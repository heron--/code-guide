# Trace glossary

These concepts belong to the Trace module. Use these definitions wherever the concepts come up, including in other modules. The project's [glossary](../../../GLOSSARY.md) applies everywhere.

**Adding, removing, or redefining a term requires the project owner's explicit approval**, as for the project's glossary.

| Term         | Definition                                                                                                                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trace**    | One concrete path through the code for one scenario, read one step at a time, with the values the code would hold. Nothing runs: each value is read from the code or inferred, and marked as which. |
| **Scenario** | One concrete situation a trace follows, e.g. "succeeds on retry". A trace follows exactly one; branches it doesn't take are shown as not taken.                                                     |
| **Step**     | One line a trace stops at: what happens there and the values the code holds at that point. A trace is read one step at a time.                                                                      |
