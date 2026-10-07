import { harnessContract } from "./contract";
import { FakeHarness } from "./fake";

harnessContract(() => new FakeHarness());
