---
type: Guide
title: Test and quality constraints
description: Quality objectives that are not negotiable, the levels of testing and their blind spots, what counts as evidence, the merge gate, recorded measurements, defect grading and residual risk
tags: [test, quality, verification, defects, risk]
status: stable
generated: { by: dsh/deepseek-flash, at: 2026-11-06T10:20:00+08:00 }
---

# Test and quality constraints

**English** | [中文](test-and-quality.zh-CN.md) | [Español](test-and-quality.es.md)

> How this extension is judged good enough: the objectives that cannot be traded away, what each
> level of testing can see, which evidence is accepted, when a change may merge, how numbers are
> recorded, and where the risk that is knowingly carried sits.

## Status of this document

This file is the quality half of the contract. [`requirements.md`](requirements.md) states what must
be true; this file states how that is proven and what counts as passing. If the two disagree, the
requirement wins and this file is wrong.

## 1. Scope and division of labour

| Document | Answers |
| :--- | :--- |
| [`requirements.md`](requirements.md) | What the extension must do, by requirement number, and what it does not promise |
| [`build-and-verify.md`](build-and-verify.md) | Which commands exist, what each one does, the test layout and the packaging steps |
| [`limitations.md`](limitations.md) | What cannot be done, and what has never been verified |
| **this file** | How the work is proven, when it may merge, and how evidence is recorded |

Commands are documented in `build-and-verify.md` and only referenced here. Repeating them in two
places is how a document starts lying about a command that changed.

## 2. Quality objectives and hard constraints

| # | Objective | Enforced by |
| :--- | :--- | :--- |
| **QO-1** | **Never modify VS Code itself.** No file outside this repository is patched, and no behaviour depends on a patch. | Seven `CustomEditorProvider` registrations and contributed views only; the deliverable is a VSIX that contains nothing but this extension |
| **QO-2** | **Strict content security.** Nothing in a webview may load a remote resource or run inline script that is not nonced. | The Strict CSP of every webview page, asserted in the page tests |
| **QO-3** | **Read-only means not loaded.** The read-only mode reads a byte budget and creates no text document. | The truncation and no-document assertions in the unit tests |
| **QO-4** | **No third-party runtime dependency.** The extension host layer is plain TypeScript on the bundled Node. | The dependency list in the manifest; the only native prerequisite is the .NET runtime the XAML view needs |
| **QO-5** | **Platform floor is a contract.** Nothing may use an API newer than the declared `engines.vscode` floor. | Compilation against the floor's type definitions; a newer API fails to compile |
| **QO-6** | **Honest labels.** Anything unverified is written down as unverified. | The residual list in §10, `limitations.md`, and the Known limitations in the README |

A change that buys a feature by spending any of these is rejected regardless of how green the suite
is.

## 3. Test levels and what each one can see

| Level | Exercises | Can prove | Cannot see |
| :--- | :--- | :--- | :--- |
| **T1 — Pure logic** | Logic through mocha in plain Node. Anything touching the editor API is kept in a separate file so that the rest can be tested without an instance. | HTML generation, CSP text, tree building, link resolution, configuration parsing, formatting, highlighting | Real rendering; whether the CSP actually blocks anything; whether a third-party script runs |
| **T2 — Front-end output** | The generated webview pages inspected as data | That a page contains the elements, nonces and attributes it should | Whether the browser does anything sensible with them |
| **T3 — Real-machine probe** | A temporary self-test extension inside a real VS Code window, with a configurable wait and page-level injections | Real rendering, whether the CSP lets things through, whether contributed scripts actually run, gesture and layout behaviour | Anything the probe does not instrument; it is not run on every change |
| **T4 — Sample replay** | The `demo/R<n>-*` fixtures opened by hand or by probe | That a documented scenario still behaves as documented | Scenarios with no fixture |
| **T5 — Consistency** | Cross-language and link checks over the documentation set | That the three language versions stay equivalent and that no link dangles | Whether the content is true |
| **T6 — CI** | A clean checkout on one runner | That the gate is reproducible from scratch | Platform behaviour on runners that are not used |

The decisive blind spot: **T1 runs in jsdom, which neither enforces CSP nor loads third-party
scripts.** Any claim about security policy or contributed scripts must therefore reach T3, or be
labelled unverified. This is the single most important boundary in the whole table.

## 4. What counts as evidence

| Accepted | Why |
| :--- | :--- |
| An assertion about what happened after an interaction | It goes red when the behaviour is wrong |
| A probe result quoted with its measured numbers | It can be re-run and reproduced |
| A rejection assertion for an invalid configuration | It goes red the moment the parser starts accepting it |
| A count printed by the runner, quoted verbatim | It is recomputable |

| Rejected | Why |
| :--- | :--- |
| "The rule exists" / "the style was written" | This repository has already paid for this lesson once |
| A screenshot instead of an assertion | Not repeatable, not diffable |
| "The command exited 0" without the counted line | The exit code does not carry the number that matters |
| A number copied from an older document | That is a memory, not a measurement |

The rejected row at the top of the second table is not hypothetical. An assertion that a style rule
had been written into the page passed while the rendering bug it was meant to catch went straight
through. The rule that replaced it: **assert what the scene did, not what the file says**. Every new
test is reviewed against that sentence.

## 5. Sufficiency

1. Every requirement in `requirements.md` reaches at least one level in §3, and the coverage is named
   in §7.
2. Every claim about a webview — rendering, content security, contributed scripts, gestures — is
   either exercised at T3 or registered in §10 as unverified. A T1 result alone never suffices.
3. Every documented scenario has a `demo/R<n>-*` fixture it can be replayed against, or is marked as
   having none.
4. Every parser of external input (configuration files, tool placeholders, JSON on disk) has a
   rejection case in addition to its happy path.
5. The number of cases the runner reports equals the number of cases designed. A skipped or silently
   dropped case is not a pass.

Coverage percentage is not a sufficiency criterion here. It cannot distinguish a test that asserts a
result from a test that merely executed a line, and that distinction is exactly the one this
repository has been burned by.

## 6. Environment

| Item | Requirement | Note |
| :--- | :--- | :--- |
| Node.js | The range accepted by the test stack, lowest supported version pinned in CI | The floor is set by the DOM implementation used in the tests, not by the extension itself |
| VS Code | The declared `engines.vscode` floor | Measured on a newer version during real-machine verification; both are recorded in `build-and-verify.md` |
| .NET | **10 Windows Desktop runtime**, XAML view only | Framework-dependent renderer; the other six views need nothing native |
| CI runner | Windows, on purpose | Several test contracts assert Windows path semantics, so a POSIX runner fails them even though the extension itself is cross-platform |
| Gate order | Install, lint, compile, test — fixed | Lint runs before test because the test command compiles again; a lint failure discovered afterwards is reported as a test failure |

`build-and-verify.md` owns the exact versions and command bodies. This table records only what the
quality argument depends on.

## 7. Traceability

Requirement numbers live in `requirements.md`; the sample directories are the replayable evidence.
This table maps by name so that numbers do not have to be copied into a second document.

| Capability | Requirement | Levels | Replayable evidence |
| :--- | :--- | :--- | :--- |
| Contributed preview scripts run under the strict policy | R1 | T1, T2, T3 | `demo/R1-injection` |
| Table of contents navigation and follow-highlight | R2 | T1, T2, T4 | `demo/R2-toc` |
| Mermaid zoom and pan | R3 | T1, T3, T4 | `demo/R3-mermaid` |
| Image wheel zoom and right-drag pan | R4 | T1, T3, T4 | `demo/R4-image` |
| Internal link and line-number routing | R5 | T1, T2, T4 | `demo/R5-jump` |
| XAML side-by-side render and write-back | R6 | T1, T3 | `demo/R6-xaml` (first generation), `demo/R12-xaml` (second generation) |
| 3D graph browsing | R8 | T1, T2, T3 | `demo/R8-graph3d` |
| Custom resource management | R9 | T1, T2, T3 | `demo/R9-resource-tree` |
| Global read-only mode | R10 | T1, T2 | `demo/R10-readonly` |
| Subtree panel | R11 | T1, T2 | `demo/R11-subtree` |
| Standalone Mermaid file view | R13 | T1, T2, T4 | `demo/R8-graph3d/04-standalone.mmd` |
| Video playback inside the editor | R14 | T1, T3 | real-window probe; no fixture directory |
| In-place paragraph editing in the Markdown view | R15 | T1, T3 | real-window probe; no fixture directory |
| In-document find in the Markdown view | R16 | T1, T2, T3 | real-window probe; no fixture directory |
| Body zoom in the Markdown view | R17 | T1, T3 | real-window probe; no fixture directory |
| Localised extension surface | R18 | T1, T5 | the manifest localisation files |
| Content security policy | cross-cutting | T1, T2, T3 | asserted in the page tests; verified on a real window |
| Documentation equivalence | cross-cutting | T5 | this documentation set |

Two numbering exceptions are deliberate and must survive any rewrite of this table: **`R7` is retired
and appears nowhere** — it was vacated rather than reassigned when the capability it had been
allocated to split in two — and **`R12` is not a capability of its own**; it names the
second-generation fixture set for `R6` and therefore belongs in the evidence column, not in a row.

Reverse traceability is the same table read upwards: a test that cannot name the capability it
protects does not belong in the suite.

## 8. Entry and exit criteria

**Entry.** Dependencies installed from the committed lockfile, and the build produced from the
current sources. The tests run against built output, so a forgotten rebuild quietly tests yesterday's
code.

**Exit.** Every step, in this order, no short-circuit:

| Step | What it is | Passes when |
| :--- | :--- | :--- |
| 1 | Install from the lockfile | It completes without changing the lockfile |
| 2 | Lint | Exit zero |
| 3 | Compile | Both stages succeed; the front-end bundles are regenerated |
| 4 | Test | Zero failures, and the reported case total matches §9 |

**No conditional passing.** A failing gate is reported as failed with the step and the counted line.
There is no retry-until-green step, and a known-unstable test is a defect in §10.

## 9. Records

Recording rules:

1. A number must be recomputable from a written command on a written environment. Otherwise it is
   removed rather than qualified.
2. A record carries the date, the runtime version and the counted output line.
3. When a number changes, the document that owns it changes in the same commit.

Recorded **2026-11-06** on Node **v24.16.0**, package version **0.2.12**:

| Measurement | Command | Result |
| :--- | :--- | :--- |
| Lint | `npm run lint` | Exit zero, no findings |
| Cases | `npm test` | **1059 passing**, 0 failing, 7 s wall clock |
| Test files | Counted in the source tree | **62 test files** |
| Platform | — | Windows, local development machine |
| VSIX contents | `npm run package` | **172 files, 1.71 MB** (`wispkit-0.2.12.vsix`) |

**A discrepancy this record originally found, now resolved.** `build-and-verify.md` stated
**57 test files / 952 cases**, numbers that predated the 3D, resource-tree and in-place-editing work.
It was brought to the counts above in the same change that added this file.

## 10. Defects and residual issues

| Severity | Definition | Example of the class |
| :--- | :--- | :--- |
| **Critical** | A webview escapes its content policy, or the extension modifies state outside its own workspace | A page loading a remote script |
| **Serious** | A visible behaviour is wrong, or a gate step does not enforce what it claims | A test that asserts a rule was written rather than applied |
| **General** | Behaviour correct, documentation or record wrong | A stale count in a document |

Open residual issues:

| # | Issue | Severity | Status |
| :--- | :--- | :--- | :--- |
| R-1 | `build-and-verify.md` carried outdated counts (57 files / 952 cases) | General | Closed — brought to the numbers in §9 in the same change |
| R-2 | jsdom enforces no content policy and loads no third-party scripts, so T1 cannot prove any security claim | Serious | Accepted — those claims require T3, and are labelled so |
| R-3 | The XAML renderer is a static snapshot with no data context and no message loop; a blank Blazor host is correct, not a failure | Serious | Accepted — documented as a limitation, not a defect |
| R-4 | The CI runner is Windows only; POSIX behaviour has no automated evidence | Serious | Accepted — recorded as a risk in §11 |
| R-5 | Real-machine probes are not part of the gate; they are run when a webview change needs them | Serious | Accepted — T3 is a deliberate manual act, not an automatic one |

R-3 and R-4 also appear in the Known limitations of the README and in `limitations.md`. When these
lists disagree, the stricter statement is authoritative until one of them is corrected.

## 11. Risks

| Risk | Impact | Current mitigation | Not mitigated |
| :--- | :--- | :--- | :--- |
| A security claim rests on jsdom | A policy regression ships unnoticed | Real-window probes for anything touching CSP or contributed scripts; the claim is labelled unverified otherwise | The probes are not automatic |
| Path semantics differ on another platform | Non-Windows users hit failures the gate cannot see | Code avoids absolute paths and uses the editor's URI handling | No CI on another platform |
| The XAML renderer is an external runtime dependency | The XAML view does nothing without .NET 10 Windows Desktop | The renderer is shipped in the VSIX as a runtime dependency; the failure is reported, not silent | The runtime itself cannot be bundled |
| A webview cannot reverse-map its own resource URLs to paths | Host and webview can disagree about which element is meant | The host re-reads the path from the document text; images get an extra attribute cross-check | Media identified only by index and kind, so a stale page can mis-target |
| Documentation counts drift | Readers trust stale figures | The recording rules in §9 | Depends on change discipline; R-1 shows it can slip |
| A fixture is treated as a test | "It works in the demo" replaces an assertion | Every scenario has a `demo/R<n>-*` fixture *and* a test where testable | Manual replay is still manual |

## 12. Change protocol

| If you change… | You must also update… | Because… |
| :--- | :--- | :--- |
| Any behaviour covered by a requirement | The matching entry in `requirements.md` | The requirement is the authority; this file only proves it |
| Any test, gate step or command | §6, §8 and §9 of this file, and `build-and-verify.md` | Two documents hold the gate; they must move together |
| Any measured number | §9 of this file and `build-and-verify.md` | Duplicated numbers diverge silently |
| A webview's policy or script loading | §3 and §4 of this file, plus a real-window probe result | T1 cannot see this class of change |
| What is verified and what is not | §10 of this file, `limitations.md`, README known limitations | Three lists describe the same residual risk |
| A sample fixture | §7 of this file | The replayable evidence inventory is part of the record |
| Any document | Its Chinese **and** Spanish versions, in the same change | A single-language document is a defect |

## Appendix — Referenced structure and what was dropped

The section skeleton of this document is adapted from a GJB quality-record package (STP / STD / STR,
type testing, metrology calibration, electrical safety, and a 9001C design-record set). The sections
below were dropped as a whole, because they describe hardware deliverables that have no observable
object for a VS Code extension:

| Dropped section | Why it does not apply |
| :--- | :--- |
| Hardware environment (temperature, humidity, power, rack) | The deliverable is a VSIX; the runtime is the user's own VS Code installation |
| Type testing, environmental stress screening, EMC emission and susceptibility | No physical entity, and no electromagnetic emission |
| Metrology calibration, traceability chain, measurement uncertainty | No measuring instrument; accuracy is guaranteed by assertions, not by instruments |
| Electrical safety, earthing, insulation withstand | Same reason |
| Design review, verification, validation and change records (9001C 8.3) | Single-maintainer repository with no independent reviewer; that role is carried by the gate in §8 and the change protocol in §12 |
| Schedule and staffing (STP §5.2 / 5.3) | No schedule and no role allocation exist to record |

The sections that were kept and rewritten for a software context are: scope, test levels and types,
test environment, test-item inventory (§7 traceability), entry and exit criteria, requirement
traceability, test records, defect and failure handling, and risk.

This note exists so that a deliberate omission is not mistaken for a missing chapter.
