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

## On a phone

**Put it on the home screen once.** Open Ncode in the phone's browser and sign in, then open
Kanban. On an iPhone: Safari → the Share button → *Add to Home Screen* → *Add*. On Android: Chrome
→ ⋮ → *Add to Home screen* (or *Install app*). The teal **Kanban** icon opens Kanban full screen,
like an app; the indigo **Ncode** icon (added from a Search & BI page) opens the analysis side. You
stay signed in.

- **Stages as tabs.** Above the board, one tab per stage with its number of tasks
  (*To do 3 · In progress 2 · Done 5*). Tap a tab or swipe sideways; one stage fills the screen.
- **Moving a task:** press and hold it for a moment, then
  - let go: big buttons for each stage (*In progress*, *Done*...) and *Open the task*;
  - or drag it onto a stage tab at the top, which lights up.
  Every move can be undone from the note at the bottom.
- **A task from a photo:** the camera button next to *+ Add a task* opens the camera; the photo
  becomes a new task in that stage, and the name ("Photo 14:05") is ready to be typed over. Big
  photos are made smaller on the phone first (about 1 MB instead of 4, quicker over mobile data;
  the location stored in the photo is left out).
- **No connection** (a weak spot in the hall): the app still opens and says *No connection* at the
  top. What is on the screen stays; changes need the connection, and the board catches up by itself
  when it is back. Nothing is stored on the phone except the app itself.
- Text fields are large enough that the iPhone does not zoom in while you type.

## For administrators

- Files are stored in `backend/data/kanban/` and are part of backups.
- `NCODE_KANBAN_MAX_UPLOAD_MB` (default 15) limits the size of one file.
- The home-screen app works on any address, but opening **without a connection** needs HTTPS
  (phones only keep an app for offline use from a secure address). With Docker and
  `NCODE_TLS=internal`, each phone must trust Caddy's certificate once - see
  [Install → HTTPS on a LAN](install.md). Over plain `http://` the icon still opens Kanban full
  screen; it just needs the connection to start.
