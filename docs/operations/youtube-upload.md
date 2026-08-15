# YouTube upload and schedule runbook

This runbook documents the GitHub delivery method used for the Milo Smiling Critters Short. It separates local production from YouTube mutation and makes the verification requirements explicit.

## Boundary

Render and QA the master locally first. GitHub Actions should receive an immutable finished MP4 plus metadata; it should not generate or edit the creative.

Never put credentials, API keys, refresh tokens, or their values in Git, command output, receipts, or documentation. GitHub Actions secrets supply the OAuth client and per-channel refresh tokens.

## Required inputs

Before dispatching an upload, record:

- target channel ID;
- final MP4 path and SHA-256;
- exact title and multi-line description;
- tags and category ID;
- owner-confirmed made-for-kids choice;
- owner-confirmed altered/synthetic-content disclosure choice;
- exact RFC3339 UTC publish time, or an explicit decision to leave it private and unscheduled;
- whether Codex should upload a thumbnail.

Do not inherit audience or disclosure choices from a previous video. Confirm them for every upload.

## Historical implementation

The repository workflow is `.github/workflows/yt-upload.yml`. The Smiling Critters upload ran from `agent/milo-smiling-critters-upload-20260814` at commit `2fe84010590bbf14fa3aff963cd591f06ae3f9e5`.

The identity assertion, explicit altered-content field, and processing poll were branch-specific hardening used by that commit; they are not all present in the current `main` version. Inspect the exact ref before dispatching and do not assume that a workflow with the same filename has the same safeguards.

That historical ref:

- looked up the OAuth refresh secret mapped to the requested channel;
- exchanged it for an access token;
- called `channels.list(mine=true)` and stopped if the token's channel did not match the requested ID;
- decoded base64 title and description fields;
- initialized a resumable `videos.insert` upload;
- uploaded the branch-local MP4;
- polled `videos.list(part=snippet,status,processingDetails)`; and
- printed identity, video ID, metadata, disclosure flags, upload status, processing status, and failure reason.

The legacy secret label mapped to Milo is not evidence of identity. The `channels.list(mine=true)` assertion is mandatory.

## Prepare and stage

First verify the master locally:

```powershell
$youtubeMaster = 'C:\path\to\final-master.mp4'
Get-FileHash -Algorithm SHA256 -LiteralPath $youtubeMaster
ffprobe -v error -show_entries format=duration,size -show_entries stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels -of json $youtubeMaster
```

The historical workflow read the media from its checked-out Git ref. Committing a large MP4 to a public branch worked, but it exposes the file and grows repository history. Prefer a private, short-lived authenticated object-storage handoff for future uploads. If the branch-local method must be used, keep it isolated from `main`, verify the staged hash against the local master, and never merge the media commit.

## Dispatch

Encode multi-line UTF-8 metadata at runtime so shell quoting cannot corrupt it:

```powershell
$youtubeRepo = 'Blovely133/vault-pulse-dashboard'
$youtubeWorkflow = 'yt-upload.yml'
$youtubeRef = 'agent/example-upload'
$youtubeChannel = 'TARGET_CHANNEL_ID'
$youtubeFile = 'uploads/channel/final-master.mp4'
$youtubeTitle = 'Exact title'
$youtubeDescription = @'
Exact first line.

#Exact #Hashtags #Shorts
'@
$youtubeTitleB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($youtubeTitle))
$youtubeDescriptionB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($youtubeDescription))
$youtubePublishAt = 'REPLACE_WITH_FUTURE_RFC3339_UTC'

gh workflow run $youtubeWorkflow `
  --repo $youtubeRepo `
  --ref $youtubeRef `
  -f channel=$youtubeChannel `
  -f file=$youtubeFile `
  -f title_b64=$youtubeTitleB64 `
  -f description_b64=$youtubeDescriptionB64 `
  -f tags_csv='comma,separated,tags' `
  -f category_id='24' `
  -f publish_at=$youtubePublishAt
```

The timestamp example is intentionally a placeholder. Calculate it at action time, confirm the intended timezone, convert it to UTC, and verify it is still in the future before dispatch.

## Required workflow behavior

A production-safe upload must:

1. Assert the OAuth identity before `videos.insert`.
2. Create the video as `private`.
3. Set `publishAt` only when a schedule was explicitly requested.
4. Apply the owner-confirmed made-for-kids and altered-content values explicitly.
5. Leave the thumbnail untouched unless the owner explicitly asked to set it.
6. Use resumable upload for the MP4.
7. Poll processing until `succeeded`, `failed`, or `terminated`.
8. Return an owner-authenticated metadata and processing readback.

The audience and disclosure fields should be parameters in a reusable workflow. The historical Smiling Critters branch hard-coded both values to false because that matched the owner's explicit choices for that upload; do not blindly copy those values to another video.

## Verification

Watch the run and then inspect its full log:

```powershell
gh run watch RUN_ID --repo Blovely133/vault-pulse-dashboard --exit-status --interval 3
gh run view RUN_ID --repo Blovely133/vault-pulse-dashboard --log
```

Require all three markers:

```text
IDENTITY_OK <expected-channel-id> "<expected-channel-name>"
YTU_OK <new-video-id>
YTU_VERIFY <json>
```

Check every readback field:

- `channelId` is the requested owner channel;
- `title` is exact;
- `privacy` is `private` before the scheduled release;
- `publishAt` is the intended UTC instant;
- made-for-kids fields match the owner's choice;
- altered/synthetic-content disclosure matches the owner's choice;
- `uploadStatus` is `processed`;
- `processingStatus` is `succeeded`; and
- `processingFailureReason` is null.

Do not treat the Action's green conclusion as proof that these values are correct. The historical script prints the readback but does not fail the job when a returned metadata value differs, and its `containsSyntheticMedia ?? false` display cannot distinguish omitted from explicitly false.

## Failure recovery

- If the run fails before `YTU_OK`, inspect the error and correct the input or authorization issue before retrying.
- If `YTU_OK` appears, a YouTube video already exists. Do not dispatch again. Use that ID for read-only inspection and repair its metadata or schedule.
- If processing reports `failed` or `terminated`, preserve the returned video ID and failure reason before deciding whether a replacement upload is necessary.
- If the schedule is wrong, update the existing private video's `publishAt`; do not create a duplicate.

## Receipt

After successful verification, save a local JSON receipt containing:

- repository, branch, commit, and Actions run URL;
- channel ID and name;
- YouTube video ID, watch URL, and Studio URL;
- source path and SHA-256;
- exact title and publish time in UTC and local timezone;
- category, audience choice, disclosure choice, and thumbnail action;
- upload and processing status; and
- verification timestamp.

Receipts must not contain OAuth tokens, API keys, secret values, or transient upload-session URLs.

## Cleanup

Do not merge a temporary media branch into `main`. Deleting a remote upload branch is a separate destructive operation and requires explicit approval after the upload ID, SHA-256, run URL, and local receipt have all been preserved.

For the historical Smiling Critters result, see [Milo Smiling Critters Hard Edition](../productions/2026-08-14-milo-smiling-critters-hard-edition.md).
