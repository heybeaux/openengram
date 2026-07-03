#!/bin/bash
set -euo pipefail

# Cross-Project Intelligence Script
# Queries engram-code API to find patterns, utilities, and inconsistencies across all indexed projects.

API_BASE="http://localhost:3002/v1"
REPORT_DATE=$(date +%Y-%m-%d)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORT_DIR="${SCRIPT_DIR}/../reports/cross-project"
REPORT_FILE="${REPORT_DIR}/${REPORT_DATE}.md"
TEMP_DIR=$(mktemp -d)

trap 'rm -rf "$TEMP_DIR"' EXIT

mkdir -p "$REPORT_DIR"

echo "=== Cross-Project Intelligence Analysis ==="
echo "Date: $REPORT_DATE"
echo "Report: $REPORT_FILE"
echo ""

# Fetch all projects
echo "Fetching projects..."
PROJECTS_JSON=$(curl -sf "$API_BASE/projects" 2>/dev/null || echo '[]')

if [ "$PROJECTS_JSON" = "[]" ] || [ -z "$PROJECTS_JSON" ]; then
  echo "ERROR: Could not fetch projects from engram-code API. Is it running on port 3002?"
  exit 1
fi

echo "$PROJECTS_JSON" > "$TEMP_DIR/projects.json"

# Extract project list
python3 -c "
import json, sys
data = json.load(open('$TEMP_DIR/projects.json'))
projects = data if isinstance(data, list) else data.get('projects', data.get('data', []))
for p in projects:
    pid = p.get('id', p.get('projectId', ''))
    name = p.get('name', p.get('projectName', 'unknown'))
    print(f'{pid}|{name}')
" > "$TEMP_DIR/project_list.txt"

echo "Found projects:"
cat "$TEMP_DIR/project_list.txt"
echo ""

# Search function
search_project() {
  local project_id="$1"
  local query="$2"
  local output_file="$3"

  local response
  response=$(curl -sf -X POST "$API_BASE/search" \
    -H "Content-Type: application/json" \
    -d "{\"projectId\": \"$project_id\", \"query\": \"$query\", \"limit\": 5}" 2>/dev/null || echo '{"error": true}')

  echo "$response" > "$output_file"
  sleep 0.2
}

# Define queries
PATTERN_KEYS="authentication error_handling database config api_design"
PATTERN_Q_authentication="authentication guard middleware"
PATTERN_Q_error_handling="error handling try catch"
PATTERN_Q_database="database query prisma supabase"
PATTERN_Q_config="environment variable configuration"
PATTERN_Q_api_design="API endpoint controller route"

UTILITY_KEYS="date_utils string_utils http_utils logging"
UTILITY_Q_date_utils="date formatting parsing utility"
UTILITY_Q_string_utils="string validation sanitization"
UTILITY_Q_http_utils="HTTP fetch request client"
UTILITY_Q_logging="logging logger service"

# Run all searches
echo "Running searches..."
while IFS='|' read -r pid pname; do
  [ -z "$pid" ] && continue
  echo "  Searching: $pname"
  mkdir -p "$TEMP_DIR/patterns/$pname" "$TEMP_DIR/utilities/$pname"

  for key in $PATTERN_KEYS; do
    varname="PATTERN_Q_$key"
    search_project "$pid" "${!varname}" "$TEMP_DIR/patterns/$pname/$key.json"
  done

  for key in $UTILITY_KEYS; do
    varname="UTILITY_Q_$key"
    search_project "$pid" "${!varname}" "$TEMP_DIR/utilities/$pname/$key.json"
  done
done < "$TEMP_DIR/project_list.txt"

echo ""
echo "Generating report..."

# Generate report with Python
TEMP_DIR="$TEMP_DIR" REPORT_FILE="$REPORT_FILE" REPORT_DATE="$REPORT_DATE" python3 << 'PYTHON_SCRIPT'
import json, os, glob, sys
from pathlib import Path

temp_dir = os.environ["TEMP_DIR"]
report_file = os.environ["REPORT_FILE"]
report_date = os.environ["REPORT_DATE"]

def load_results(filepath):
    """Load search results from a JSON file, return list of relevant snippets."""
    try:
        with open(filepath) as f:
            data = json.load(f)
        if isinstance(data, dict) and data.get("error"):
            return []
        results = data if isinstance(data, list) else data.get("results", data.get("data", []))
        snippets = []
        for r in results[:5]:
            path = r.get("filePath", r.get("path", r.get("file", "")))
            content = r.get("content", r.get("snippet", r.get("text", "")))
            score = r.get("score", r.get("similarity", 0))
            if path:
                # Truncate content for readability
                content_preview = content[:200].replace("\n", " ").strip() if content else ""
                snippets.append({"path": path, "content": content_preview, "score": score})
        return snippets
    except (json.JSONDecodeError, FileNotFoundError, KeyError):
        return []

def summarize_approach(snippets):
    """Create a brief summary from snippets."""
    if not snippets:
        return "No relevant code found"
    paths = [s["path"] for s in snippets[:3]]
    contents = [s["content"] for s in snippets[:2] if s["content"]]
    summary_parts = []
    # Infer approach from file paths and content
    path_str = " ".join(paths).lower()
    content_str = " ".join(contents).lower()

    # Auth detection
    if "guard" in path_str or "guard" in content_str:
        summary_parts.append("NestJS Guards")
    if "middleware" in path_str or "middleware" in content_str:
        summary_parts.append("Middleware-based")
    if "supabase" in content_str or "rls" in content_str:
        summary_parts.append("Supabase RLS")
    if "api-key" in path_str or "apikey" in content_str or "api_key" in content_str:
        summary_parts.append("API Key auth")
    if "jwt" in content_str or "token" in content_str:
        summary_parts.append("JWT/Token auth")
    if "prisma" in content_str:
        summary_parts.append("Prisma ORM")
    if "supabase" in content_str:
        summary_parts.append("Supabase client")
    if "nestjs/config" in content_str or "configservice" in content_str or "configmodule" in content_str:
        summary_parts.append("@nestjs/config (ConfigService)")
    if "process.env" in content_str or "dotenv" in content_str:
        summary_parts.append("process.env / dotenv")
    if "next" in path_str and "env" in content_str:
        summary_parts.append("Next.js env")
    if "winston" in content_str:
        summary_parts.append("Winston logger")
    if "logger" in path_str or "nestjs" in content_str:
        summary_parts.append("NestJS Logger")
    if "pino" in content_str:
        summary_parts.append("Pino logger")
    if "console.log" in content_str:
        summary_parts.append("console.log")
    if "axios" in content_str:
        summary_parts.append("Axios")
    if "fetch" in content_str:
        summary_parts.append("Native fetch")

    if not summary_parts:
        # Fallback: show top file paths
        summary_parts = [os.path.basename(p) for p in paths[:2]]

    key_files = ", ".join([os.path.basename(p) for p in paths[:3]])
    return f"{'; '.join(set(summary_parts))} — files: {key_files}"

# Collect all project names
projects = []
patterns_dir = os.path.join(temp_dir, "patterns")
if os.path.isdir(patterns_dir):
    projects = sorted(os.listdir(patterns_dir))

pattern_categories = {
    "authentication": "Authentication",
    "error_handling": "Error Handling",
    "database": "Database Access",
    "config": "Configuration",
    "api_design": "API Design"
}

utility_categories = {
    "date_utils": "Date Formatting/Parsing",
    "string_utils": "String Validation/Sanitization",
    "http_utils": "HTTP Client",
    "logging": "Logging"
}

# Build report
lines = []
lines.append(f"# Cross-Project Intelligence Report — {report_date}\n")
lines.append(f"**Projects analyzed:** {len(projects)}\n")
for p in projects:
    lines.append(f"- {p}")
lines.append("")

# Shared Patterns
lines.append("## Shared Patterns\n")
for key, title in pattern_categories.items():
    lines.append(f"### {title}\n")
    for proj in projects:
        filepath = os.path.join(patterns_dir, proj, f"{key}.json")
        snippets = load_results(filepath)
        summary = summarize_approach(snippets)
        lines.append(f"- **{proj}**: {summary}")
    lines.append("")

# Duplicated Utilities
lines.append("## Duplicated Utilities\n")
utility_presence = {}
for key, title in utility_categories.items():
    found_in = []
    for proj in projects:
        filepath = os.path.join(temp_dir, "utilities", proj, f"{key}.json")
        snippets = load_results(filepath)
        if snippets:
            found_in.append(proj)
    utility_presence[key] = found_in
    count = len(found_in)
    if count > 0:
        proj_list = ", ".join(found_in)
        candidate = " — **candidate for shared package**" if count >= 3 else ""
        lines.append(f"- **{title}**: found in {count} project(s) ({proj_list}){candidate}")
    else:
        lines.append(f"- **{title}**: not found in any project")
lines.append("")

# Inconsistencies
lines.append("## Inconsistencies\n")

# Compare auth approaches
lines.append("### Authentication Approaches")
auth_approaches = {}
for proj in projects:
    filepath = os.path.join(patterns_dir, proj, "authentication.json")
    snippets = load_results(filepath)
    auth_approaches[proj] = summarize_approach(snippets)

unique_approaches = set(auth_approaches.values()) - {"No relevant code found"}
if len(unique_approaches) > 1:
    lines.append(f"\n⚠️ **{len(unique_approaches)} different auth approaches detected:**\n")
    for proj, approach in auth_approaches.items():
        if approach != "No relevant code found":
            lines.append(f"- {proj}: {approach}")
else:
    lines.append("\n✅ Auth approaches are consistent (or only one project uses auth).\n")
lines.append("")

# Compare config approaches
lines.append("### Configuration Approaches")
config_approaches = {}
for proj in projects:
    filepath = os.path.join(patterns_dir, proj, "config.json")
    snippets = load_results(filepath)
    config_approaches[proj] = summarize_approach(snippets)

unique_configs = set(config_approaches.values()) - {"No relevant code found"}
if len(unique_configs) > 1:
    lines.append(f"\n⚠️ **{len(unique_configs)} different config approaches detected:**\n")
    for proj, approach in config_approaches.items():
        if approach != "No relevant code found":
            lines.append(f"- {proj}: {approach}")
else:
    lines.append("\n✅ Config approaches are consistent.\n")
lines.append("")

# Compare error handling
lines.append("### Error Handling Approaches")
error_approaches = {}
for proj in projects:
    filepath = os.path.join(patterns_dir, proj, "error_handling.json")
    snippets = load_results(filepath)
    error_approaches[proj] = summarize_approach(snippets)

unique_errors = set(error_approaches.values()) - {"No relevant code found"}
if len(unique_errors) > 1:
    lines.append(f"\n⚠️ **{len(unique_errors)} different error handling approaches detected:**\n")
    for proj, approach in error_approaches.items():
        if approach != "No relevant code found":
            lines.append(f"- {proj}: {approach}")
else:
    lines.append("\n✅ Error handling is consistent.\n")
lines.append("")

# Recommendations
lines.append("## Recommendations\n")
rec_num = 1

for key, title in utility_categories.items():
    if len(utility_presence.get(key, [])) >= 3:
        lines.append(f"{rec_num}. **Extract shared {title.lower()} package** — found in {len(utility_presence[key])} projects, consolidate to reduce duplication")
        rec_num += 1

if len(unique_approaches) > 1:
    lines.append(f"{rec_num}. **Standardize authentication** — {len(unique_approaches)} different approaches detected; consider a shared auth module")
    rec_num += 1

if len(unique_configs) > 1:
    lines.append(f"{rec_num}. **Standardize configuration management** — inconsistent approaches across projects")
    rec_num += 1

if len(unique_errors) > 1:
    lines.append(f"{rec_num}. **Standardize error handling** — create shared error classes and handlers")
    rec_num += 1

if rec_num == 1:
    lines.append("No major recommendations — projects appear consistent.")

lines.append("")
lines.append("---")
lines.append(f"*Generated by cross-project-intelligence.sh on {report_date}*")

with open(report_file, "w") as f:
    f.write("\n".join(lines))

print(f"Report written to {report_file}")
PYTHON_SCRIPT

echo "Done! Report: $REPORT_FILE"
