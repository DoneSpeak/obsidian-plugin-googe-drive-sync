#!/bin/bash
# Build and package the plugin for distribution
set -e

PLUGIN_NAME="omnisync-gdrive"
OUTPUT_DIR="./dist"

echo "🔨 Building plugin..."
npm run build

echo "📁 Creating release package..."
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

# Copy required files
cp main.js manifest.json "$OUTPUT_DIR/"

# Copy styles.css if it exists
if [ -f styles.css ]; then
  cp styles.css "$OUTPUT_DIR/"
fi

# Create zip with files at the root so users can unzip directly
# into .obsidian/plugins/<plugin-id>/
cd "$OUTPUT_DIR"
zip -r "${PLUGIN_NAME}.zip" main.js manifest.json styles.css
cd ..

echo "✅ Release package created: dist/${PLUGIN_NAME}.zip"
echo ""
echo "📦 Package contents:"
ls -la "$OUTPUT_DIR/"