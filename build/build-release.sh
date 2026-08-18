#!/bin/bash
# Build and package the plugin for distribution
set -e

PLUGIN_NAME="gdrive-sync"
OUTPUT_DIR="./dist/$PLUGIN_NAME"

echo "🔨 Building plugin..."
npm run build

echo "📁 Creating release package..."
mkdir -p "$OUTPUT_DIR"

# Copy required files
cp main.js manifest.json "$OUTPUT_DIR/"

# Copy styles.css if it exists
if [ -f styles.css ]; then
  cp styles.css "$OUTPUT_DIR/"
fi

# Create zip
cd ./dist
zip -r "${PLUGIN_NAME}.zip" "$PLUGIN_NAME"
cd ..

echo "✅ Release package created: dist/${PLUGIN_NAME}.zip"
echo ""
echo "📦 Package contents:"
ls -la "$OUTPUT_DIR/"