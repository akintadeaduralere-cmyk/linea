# Linea

A skin for Video.js 10: a film player machined like an instrument, that moves through a film one spoken line at a time.
Two skins: **Silver** (the default) and **Smoked glass**.

Live demo: https://akintadeaduralere-cmyk.github.io/linea/

## Install

Both skins use the same two files. Nothing else to download.

1. In the page head, load Video.js 10 and the Linea stylesheet:

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@videojs/cdn@10.3.0/video-player.js"></script>
<script type="module" src="https://cdn.jsdelivr.net/npm/@videojs/cdn@10.3.0/ui/container.js"></script>
<script type="module" src="https://cdn.jsdelivr.net/npm/@videojs/cdn@10.3.0/media/hls-video.js"></script>
<link rel="stylesheet" href="https://akintadeaduralere-cmyk.github.io/linea/skin/linea.css">
```

2. Wrap your video:

```html
<div id="player" reel-title="My film">
  <video-player><media-container>
    <hls-video src="your-stream.m3u8" playsinline crossorigin>
      <track kind="captions" srclang="en" label="English" src="captions.vtt" default>
    </hls-video>
  </media-container></video-player>
</div>
```

3. Mount the skin:

```html
<script type="module">
  import { mountSentenceReel } from 'https://akintadeaduralere-cmyk.github.io/linea/skin/linea.js';
  const host = document.getElementById('player');
  mountSentenceReel(host, host.querySelector('hls-video'));
</script>
```

## Choose the skin

Silver is the default. For **Smoked glass**, add `skin="smoked"` to the player's div:

```html
<div id="player" skin="smoked" reel-title="My film">
```

Smoked glass has the same controls. Its seek track has one slot per spoken line (a click goes to that line), and its
caption window counts the lines (LINE 04 / 86).

## Accent and type

Set these CSS custom properties on the player (or the page) to change the accent in both skins:
`--ember`, `--ember-hot` (a lighter tint), `--ember-glow` (the colour at about 60% opacity) and `--l-now`.
`--sr-accent-turn` (in degrees: the hue difference from #ff5a1f) turns the rendered silver parts to the same accent.
`--sr-font-names` and `--sr-font-window` set the type.

## Source

The skin's source is in `source/sentence-reel`. Linea is a self-initiated concept made for the Video.js skins challenge.
Open source under Apache 2.0 (see LICENSE). Demo film: Tears of Steel and its subtitles (CC) Blender Foundation, mango.blender.org, CC BY 3.0.
