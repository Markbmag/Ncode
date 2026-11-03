# Ncode - Kanban

Task boards for the team, next to the BI workspace. After signing in, pick **Ncode - Kanban** on the
start page (Ncode remembers the choice; the ⊞ button switches back to Search & BI).

## Boards

- **+ New board** creates one with three stages: *To do · In progress · Done*. Rename, colour, add or
  remove stages with each stage's *More* menu; a stage marked as *done* counts its tasks as finished.
- **Everyone** signed in can see every board. **Members** (people or groups) can change it; owners
  choose the members (*Members* at the top of the board). Admins can do everything.
- *More → Hide the board* puts it under *Hidden boards*, from where it can be brought back.

## Tasks

- **+ Add a task** at the top of a stage. Click a task to open it; changes save by themselves.
- **What needs to be done**, **Who** (several people), **When** (start and due date; late tasks turn
  red and say "3 days late"), **How important** (Low · Normal · High · Urgent), **Labels**.
- **Steps**: the action plan. Tick steps as they are done; the task and the board show
  "2 of 5 steps done" with a bar.
- **Photos and files**: *Add photo or file* (on a phone this opens the camera). Up to 15 MB each.
- **Comments** and **History** (who did what, when) at the bottom.
- Move a task with **Move to…** on the task, or drag it. A note at the bottom offers **Undo**.
- *Remove from the board* hides a task (it can be brought back from *Hidden tasks*).

## Working together

Everyone looking at a board sees changes as they happen, with a short note such as
"carol moved “Leak under press 4” to Done".

## For administrators

- Files are stored in `backend/data/kanban/` and are part of backups.
- `NCODE_KANBAN_MAX_UPLOAD_MB` (default 15) limits the size of one file.
