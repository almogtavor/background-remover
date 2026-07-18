# A Free Background Remover (For Real)

A fully client-side background remover. No uploads, no accounts, no watermarks - everything runs in your browser with color-key removal, edge softness, and boundary outline controls.

**Live site:** https://almogtavor.github.io/background-remover/

## Features

- Upload, drag-and-drop, or paste (Ctrl/Cmd+V) an image
- Automatic background color detection, or pick a pixel manually
- Tolerance and edge softness sliders
- Optional removal of only edge-connected background
- Optional colored boundary outline
- Download the result as a transparent PNG

## Development

It's a static site - open `background-remover/index.html` in a browser, or serve the folder:

```sh
cd background-remover
python3 -m http.server
```
