# Immersive EVI - Voice AI Demo

A beautiful, immersive voice AI interface powered by Hume EVI.

## 🚀 Deploy to Vercel (Free)

### Step 1: Get Your Hume API Credentials

1. Go to [Hume AI Platform](https://platform.hume.ai/)
2. Sign up or log in
3. Navigate to **Settings → API Keys**
4. Create a new API key and note down:
   - **API Key** (Client ID)
   - **Secret Key** (Client Secret)

### Step 2: Deploy with Vercel

#### Option A: One-Click Deploy (Easiest)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/YOUR_REPO)

#### Option B: Manual Deploy

1. **Install Vercel CLI** (if not already installed):
   ```bash
   npm install -g vercel
   ```

2. **Deploy from this directory**:
   ```bash
   cd evi-react-immersive
   vercel
   ```

3. **Follow the prompts** - Vercel will ask you to link or create a project

### Step 3: Add Environment Variables (CRITICAL)

After deploying, you MUST add your API keys in Vercel:

1. Go to your project on [vercel.com](https://vercel.com)
2. Navigate to **Settings → Environment Variables**
3. Add these variables:

   | Name | Value | Environment |
   |------|-------|-------------|
   | `HUME_API_KEY` | Your Hume API Key | Production, Preview, Development |
   | `HUME_SECRET_KEY` | Your Hume Secret Key | Production, Preview, Development |
   | `NEXT_PUBLIC_HUME_CONFIG_ID` | (Optional) Your EVI Config ID | Production, Preview, Development |

4. **Redeploy** your project for changes to take effect

## 🔒 Security

This app uses a secure authentication flow:
- API keys are **never exposed** to the browser
- Server-side API route fetches access tokens
- Only temporary access tokens are sent to the client
- `.env.local` is gitignored to prevent accidental commits

## 🛠 Local Development

1. Copy the environment example:
   ```bash
   cp env.example .env.local
   ```

2. Fill in your Hume credentials in `.env.local`

3. Install dependencies:
   ```bash
   npm install
   ```

4. Run the development server:
   ```bash
   npm run dev
   ```

5. Open [http://localhost:3001](http://localhost:3001)

## 📁 Project Structure

```
evi-react-immersive/
├── app/
│   ├── api/
│   │   └── hume-token/
│   │       └── route.ts    # Secure token endpoint
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx            # Main entry point
├── components/
│   └── ImmersiveEVI.tsx    # Voice interface component
├── public/
│   └── video.mov           # Background video
└── ...
```

## ✨ Features

- 🎙️ Real-time voice conversation
- 🎭 Emotion detection and display
- ⏸️ Smart pause/resume with keywords
- ⚡ Quick/Detailed response modes
- 🎨 Beautiful glassmorphism UI
- 📱 Responsive design
