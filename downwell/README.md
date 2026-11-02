# Downwell Cloud

Your ad-free browser downloader for authorized YouTube videos and Shorts.

This is a standalone app on the `downwell-cloud-app` branch; the repository's `main` branch is unchanged.

## Hosting
Docker build context: `downwell`.
Dockerfile: `downwell/Dockerfile`.
Environment: `DOWNWELL_ACCESS_KEY` (at least 12 characters), `FLASK_SECRET_KEY` (random 32-byte hex), and `PORT` (Render supplies it).
Render free plan: app sleeps after inactivity; files expire after 40 minutes. Maximum file size is 350 MB, max duration 2 hours, up to two concurrent downloads. Cloud IP blocking by YouTube is possible.

## Privacy
Sign-in is required. No advertisements, analytics, or third-party converter pages. Files are processed on the Render server and fetched in your browser. Only download videos you are authorized to save.
