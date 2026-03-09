# AGENTS

<skills_system priority="1">

## Available Skills

<!-- SKILLS_TABLE_START -->
<usage>
When users ask you to perform tasks, check if any of the available skills below can help complete the task more effectively. Skills provide specialized capabilities and domain knowledge.

How to use skills:
- Each skill has a <path> tag containing the full path to the SKILL.md file
- Read the skill file directly using: Read("<path-from-skill-tag>")
- The skill content will load with detailed instructions on how to complete the task
- The parent directory of SKILL.md contains bundled resources (references/, scripts/, assets/)

Usage notes:
- Only use skills listed in <available_skills> below
- Do not invoke a skill that is already loaded in your context
- Each skill invocation is stateless

Skills directory: C:\Users\Administrator\.claude\skills
</usage>

<available_skills>

</available_skills>
<skill>
<name>daily-summary</name>
<description>Generate daily work reports from Cursor chat history. Use when users request work summaries, daily reports, or need to review daily work content. Supports querying sessions by date, reading conversations, identifying work types, extracting tech debt, and saving summaries. Can optionally integrate git commit analysis.</description>
<path>C:\Users\Administrator\.claude\skills\daily-summary\SKILL.md</path>
<location>global</location>
</skill>

<skill>
<name>frontend-design</name>
<description>Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, artifacts, posters, or applications (examples include websites, landing pages, dashboards, React components, HTML/CSS layouts, or when styling/beautifying any web UI). Generates creative, polished code and UI design that avoids generic AI aesthetics.</description>
<path>C:\Users\Administrator\.claude\skills\frontend-design\SKILL.md</path>
<location>global</location>
</skill>

<skill>
<name>go-react-stack</name>
<description>Create a new Go+React full-stack project with DDD architecture, OpenSpec specifications, and React best practices. Includes complete project scaffolding with backend (Go with Gin), frontend (React with TypeScript), OpenSpec structure, and example code following project conventions. Use this skill when users request creating a new full-stack project, scaffolding a Go+React application, or setting up a project with OpenSpec specifications.</description>
<path>C:\Users\Administrator\.claude\skills\go-react-stack\SKILL.md</path>
<location>global</location>
</skill>

<skill>
<name>openspec</name>
<description>Specification-driven development workflow tool for reaching consensus on requirements before coding. Use when working with OpenSpec workflows, creating change proposals, implementing approved changes, or archiving completed work.</description>
<path>C:\Users\Administrator\.claude\skills\openspec\SKILL.md</path>
<location>global</location>
</skill>

<skill>
<name>user-profile</name>
<description>Generate personalized user profile from Cursor chat history to help AI understand coding style, technical preferences, and communication habits. Use when users want to create or update their profile, or say "let Cursor know me better", "analyze my habits", "generate my profile".</description>
<path>C:\Users\Administrator\.claude\skills\user-profile\SKILL.md</path>
<location>global</location>
</skill>

<skill>
<name>web-artifacts-builder</name>
<description>Suite of tools for creating elaborate, multi-component claude.ai HTML artifacts using modern frontend web technologies (React, Tailwind CSS, shadcn/ui). Use for complex artifacts requiring state management, routing, or shadcn/ui components - not for simple single-file HTML/JSX artifacts.</description>
<path>C:\Users\Administrator\.claude\skills\web-artifacts-builder\SKILL.md</path>
<location>global</location>
</skill>

<skill>
<name>webapp-testing</name>
<description>Toolkit for interacting with and testing local web applications using Playwright. Supports verifying frontend functionality, debugging UI behavior, capturing browser screenshots, and viewing browser logs.</description>
<path>C:\Users\Administrator\.claude\skills\webapp-testing\SKILL.md</path>
<location>global</location>
</skill>

<skill>
<name>weekly-summary</name>
<description>Generate weekly work reports by aggregating daily summaries. Use when users request weekly reports, weekly summaries, or need to review accomplishments over a week period. Focuses on key accomplishments and progress suitable for upward reporting.</description>
<path>C:\Users\Administrator\.claude\skills\weekly-summary\SKILL.md</path>
<location>global</location>
</skill>

<skill>
<name>simple-skill</name>
<description>A simple skill example for testing the marketplace plugin system.</description>
<path>/Users/xibaobao/.claude/skills/simple-skill/SKILL.md</path>
<location>global</location>
</skill>

<!-- SKILLS_TABLE_END -->

</skills_system>

<!-- OPENSPEC:START -->
## OpenSpec

This project uses [OpenSpec](openspec/) for specification-driven development.

- Read `openspec/AGENTS.md` for the full workflow guide
- Read `openspec/project.md` for project context
- Active changes live in `openspec/changes/`
- Specifications live in `openspec/specs/`
<!-- OPENSPEC:END -->
