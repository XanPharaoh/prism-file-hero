<br />

***

# CRITICAL PROTOCOL: State Synchronization & Anti-Hallucination Rules

## 1. THE GOLDEN RULE

**You are strictly forbidden from updating the** **`complete source code with updates.md`** **file (or any changelog) until you have physically verified the code changes exist on the disk.**
Claiming a task is complete in the changelog without the corresponding code being written to the file system is a critical failure ("Ghost Commit").

## 2. MANDATORY EXECUTION WORKFLOW

For every task involving code modification, you MUST follow this exact sequence:

1. **READ**: Read the current content of the target file from the file system.
2. **EDIT**: Apply the necessary code changes to the file.
3. **VERIFY**: Re-read the file from the disk (using a tool like `cat`, `grep`, or file read) to confirm the specific changes (e.g., specific function names, variable values, imports) are actually present.
4. **DOCUMENT**: Only after verification passes, update the `complete source code with updates.md` file.

## 3. SOURCE CODE BLOCK SYNCHRONIZATION

If the project uses a master tracking file (like `complete source code with updates.md`) that contains verbatim source code blocks:

- **Verbatim Updates**: You must replace the *entire* old code block with the *new, fully updated* code block. Do not use placeholders like `// ... rest of code unchanged`.
- **No Orphans**: Every file listed in the "Files Modified" section of the changelog MUST have a corresponding, up-to-date code block in the Source Code section of the tracking file.
- **Timestamp Sync**: The "Last modified" timestamp in the code block header must match the timestamp in the changelog entry.

## 4. ANTI-HALLUCINATION CHECKS

Before marking any task as "Complete", you must internally answer these questions:

- *Did I actually write the code to the file, or did I just plan to?*
- *If I grep for the new function/variable right now, will it return a result?*
- *Does the code block in the markdown file match the code block on the disk exactly?*

If the answer to any of these is "No" or "Unsure", you must stop and execute the missing steps.

## 5. ERROR RECOVERY

If you realize you have created a "Ghost Commit" (changelog says X, disk says Y):

1. Immediately halt all new feature work.
2. Read the actual file from disk.
3. Apply the missing changes to the disk file.
4. Verify the disk file.
5. Update the tracking file to reflect reality.
6. Add a "SYNC CORRECTION" entry to the changelog explaining the fix.

## 6. STRICT PROHIBITIONS

- ❌ Do not say "I have updated the file" if you haven't run a write command.
- ❌ Do not summarize code changes in the changelog without providing the full code block in the tracking file (if required by project rules).
- ❌ Do not assume the file state from previous context windows. Always read the file fresh.
- ❌ Do not use `// ... existing code ...` in the master tracking file's source code section. It must be complete and compilable.

