# Blackboard Download

A browser extension that enables users to download course materials, PDFs, and other resources from Blackboard Learn learning management system.

## Features

- **Easy PDF Download**: Quickly download PDF files from your Blackboard courses
- **Bulk Download**: Download multiple files at once
- **Simple Interface**: User-friendly popup panel for quick access
- **Course Material Access**: Download lecture notes, assignments, and other course materials

## Project Structure

```
.
├── manifest.json           # Extension configuration
├── popup.html             # Popup interface
├── popup.css              # Popup styling
├── panel.css              # Panel styling
├── downloader.js          # Core download logic
├── service-worker.js      # Service worker for background tasks
├── blackboard-plus-pdf-downloader.zip  # Packaged extension
└── README.md              # This file
```

## Installation

### From Source
1. Clone this repository
2. Open your browser's extension management page (e.g., `chrome://extensions/`)
3. Enable "Developer mode"
4. Click "Load unpacked" and select this repository folder

### From Package
Extract `blackboard-plus-pdf-downloader.zip` and follow the installation steps above.

## Usage

1. Navigate to your Blackboard course page
2. Click the extension icon in your browser toolbar
3. Select the materials you want to download
4. Click the download button
5. Files will be saved to your default downloads folder

## How It Works

- **popup.html/popup.css**: Provides the user interface for the extension
- **downloader.js**: Handles the core functionality of detecting and downloading files from Blackboard
- **service-worker.js**: Manages background tasks and communication between the extension components
- **manifest.json**: Defines extension permissions and configuration

## Technical Details

This is a browser extension built with:
- JavaScript for core functionality
- HTML/CSS for the user interface
- Service Workers for background operations

## Browser Compatibility

This extension is designed for Chromium-based browsers (Chrome, Edge, Brave, etc.).

## Troubleshooting

- **Extension doesn't appear**: Make sure it's enabled in your browser's extension settings
- **Downloads fail**: Verify you're logged into Blackboard and have permission to access the materials
- **UI issues**: Clear your browser cache and reload the extension

## Contributing

Feel free to submit issues and enhancement requests!

## License

This project is provided as-is for educational purposes.

## Support

For issues or questions about using this extension, please open an issue in this repository.