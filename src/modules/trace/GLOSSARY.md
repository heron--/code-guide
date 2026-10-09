# Trace glossary

Terms that name only the Trace module's ideas: in its jobs and panel, and wherever other code handles them (Chat asking about a step). The project's [glossary](../../../GLOSSARY.md) applies everywhere; these words never stand in for its terms (a "step" is never a chapter).

**Adding, removing or redefining a term requires the project owner's approval**, as for the project's glossary.

| Term         | Definition                                                                                                                                                                                          | Not to be confused with                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Trace**    | One concrete path through the code for one scenario, read one step at a time, with the values the code would hold. Nothing runs: each value is read from the code or inferred, and marked as which. | A stack trace, a log, or a recorded run. Nothing is executed; a trace is the agent's reading of the code. |
| **Scenario** | One concrete situation a trace follows, e.g. "succeeds on retry". A trace follows exactly one; branches it doesn't take are shown as not taken.                                                     | A test case. A scenario is never run.                                                                     |
| **Step**     | One line a trace stops at: what happens there and the values the code holds at that point. A trace is read one step at a time.                                                                      | A chapter. A chapter explains one idea; a step is one point on a path.                                    |
