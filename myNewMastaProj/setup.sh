#!/bin/bash
# for setting up the project with a single command: npm run setup
# When a project is cloned, this script will be run to install 
# all dependencies and set up the environment.

echo "🚀 Starting Project Setup..."

# 1. Install Root Dependencies (Mastra)
echo "📦 Installing root dependencies..."
npm install

# 2. Install Web Dependencies (Next.js)
if [ -d "web" ]; then
  echo "📦 Installing web dependencies..."
  cd web
  npm install
  cd ..
fi

# 3. Setup Environment Variables (Optional)
# If you have a .env.example, this copies it to .env so the app doesn't crash
if [ -f ".env.example" ] && [ ! -f ".env" ]; then
  echo "🔑 Creating .env from .env.example..."
  cp .env.example .env
fi

# 4. Setup Web Environment Variables (Optional)
if [ -d "web" ] && [ -f ".env" ] && [ ! -f "web/.env.local" ]; then
  echo "🔗 Linking root .env to web/.env.local for convenience..."
  cp .env web/.env.local
fi

echo "✅ Setup complete! You can now run 'npm run dev'."