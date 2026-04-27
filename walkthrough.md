# GitHub & Render Deployment Walkthrough

I have prepared your **YT2MP3** project for live hosting on Render.com using your GitHub repository. Below is a detailed summary of the actions I performed on your local files.

## 1. Cloud-Ready Code Updates
To make the code work on a web server instead of just your PC, I made two critical changes:
*   **Dynamic Port**: Updated `server.js` to use `process.env.PORT`. Render assigns a port (usually 10000) automatically.
*   **Origin Detection**: Updated `script.js` to use `window.location.origin`. This allows the frontend to find the backend whether it's on `localhost` or your live URL.
*   **Smart Binary Paths**: Modified the backend to detect if it's running on Windows (local) or Linux (Render) and use the correct paths for `yt-dlp` and `ffmpeg`.

## 2. Docker Integration (For FFmpeg & yt-dlp)
Standard free hosts don't have conversion tools pre-installed. I created a **Dockerfile** which:
*   Sets up a Linux Environment (Node 18).
*   Installs **FFmpeg** and **Python** via system packages.
*   Downloads the latest **yt-dlp** binary.
*   Ensures your app has all the tools it needs to convert YouTube to MP3 for free.

## 3. Git Repository Setup
I performed the following commands in your `website1` directory:

1.  **Created `.gitignore`**: To ensure we don't upload unnecessary folders like `node_modules`.
2.  **Initialized Git**: `git init` - Started a local repository.
3.  **Configured Identity**:
    *   `git config user.name "sreepardheevkumar"`
    *   `git config user.email "sreepardheevkumar@gmail.com"`
4.  **Staged & Committed**:
    *   `git add .` - Selected all project files.
    *   `git commit -m "initial_commit"` - Saved the state locally.
5.  **Linked Remote**:
    *   `git remote add origin https://github.com/sreepardheevkumar/yt2mp3` - Connected your local code to your GitHub repo.

---

## 🚀 How to Finish the Push
Because I don't have your GitHub password/token, you must run the final step yourself in your terminal:

```bash
cd "c:\Users\hp\Downloads\New folder (2)\website1"
git push -u origin main
```

## 🌍 Hosting on Render
1.  Go to **Render.com**.
2.  Create a **New Web Service**.
3.  Connect the `yt2mp3` GitHub repo.
4.  **REALLY IMPORTANT**: Set the **Runtime** to **Docker** in the Render settings.

Your app will be live and free forever!
