# Third-party components

AMT Studio includes these third-party components. Their respective license files are included in the packaged `node_modules` or in `licenses/`.

- **Device Management Toolkit UI Toolkit 3.3.22** — Copyright Intel Corporation and contributors; Apache License 2.0. https://github.com/device-management-toolkit/ui-toolkit. AMT Studio uses its KVM decoder and keycode mapping. The Vite build replaces evaluation of two constant Huffman lookup-table strings with JSON parsing to support a Content Security Policy without `unsafe-eval`. The application adds buffering around the initial RFB negotiation.
- **React / React DOM** — Copyright Meta Platforms, Inc. and affiliates; MIT License. https://github.com/facebook/react
- **Lucide React** — Copyright Lucide contributors; ISC License (with inherited Feather notices in its license). https://github.com/lucide-icons/lucide
- **fast-xml-parser** and its runtime dependencies — their licenses are included with their installed packages. https://github.com/NaturalIntelligence/fast-xml-parser

Additional transitive packages retain their license files in `node_modules`. No MeshCommander application source is bundled. Intel's AMT documentation and the MeshCommander implementation were consulted as protocol references.

Version 0.2 also uses the toolkit's AMT storage-redirection decoder. AMT Studio supplies a file-backed sector reader, bounds checks, flow control, large-image arithmetic and rejection of write commands. These adaptations run in a separate worker thread.

- **xterm.js and FitAddon** — Copyright xterm.js authors; MIT License. https://github.com/xtermjs/xterm.js
- **ws** — Copyright Einar Otto Stangvik and contributors; MIT License. https://github.com/websockets/ws

Version 0.3 bundles **Manrope**, **Outfit** and **Space Grotesk** locally through Fontsource. The fonts are distributed under the SIL Open Font License 1.1; the individual copyright notices and full license texts are included in `licenses/*-OFL.txt`. No font request is sent to an external service by the application.
