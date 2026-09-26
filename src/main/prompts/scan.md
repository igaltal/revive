Index this folder for Revive. Identify every distinct project by
its markers (package.json, pyproject.toml, requirements.txt,
Dockerfile, index.html). For each: a one sentence description a non
technical person would recognize, in English and in natural native
Hebrew, with no framework names; stack; install and dev commands
verified from the files; port; env keys the code reads with a plain
purpose in both languages. Write .revive/manifest.json matching the
schema in .revive/schema.json. Merge with an existing file and never
change fields listed in user_locked. Never write secret values. If
unsure, write null and add a note. Do not modify any file outside
.revive/.
