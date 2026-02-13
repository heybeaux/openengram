# Task: Refactor Large File

## Trigger
Architecture Watchdog detects file > 500 lines

## Input
- File path
- Current line count
- Module name

## Instructions
1. Read the file, understand its responsibilities
2. Query engram-code for semantic understanding:
   `POST http://localhost:3002/v1/search {"query": "<file purpose>", "projectId": "af22c027-7495-46d7-9c4d-d0d89e07a1bb", "limit": 10}`
3. Identify logical groupings of functions/methods
4. Split into multiple files, each with a single responsibility
5. Update imports across the codebase
6. Ensure all tests still pass
7. Add tests for any untested extracted code

## Constraints
- Each new file should be < 300 lines
- Maintain backward compatibility (re-export from original location if needed)
- Don't change public API signatures
- Follow existing module patterns in the codebase
