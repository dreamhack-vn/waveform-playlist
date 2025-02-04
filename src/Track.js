import _assign from 'lodash.assign';
import _forOwn from 'lodash.forown';
import _keys from 'lodash.keys';
import audioBufferUtil from 'audio-buffer-utils';

import uuid from 'uuid';
import h from 'virtual-dom/h';

import extractPeaks from 'webaudio-peaks';
import { FADEIN, FADEOUT } from 'fade-maker';

import { secondsToPixels, secondsToSamples, cueFormatters, samplesToSeconds } from './utils/conversions';
import stateClasses from './track/states';

import CanvasHook from './render/CanvasHook';
import FadeCanvasHook from './render/FadeCanvasHook';
import VolumeSliderHook from './render/VolumeSliderHook';
import StereoPanSliderHook from './render/StereoPanSliderHook';
import Playout from './Playout';

const MAX_CANVAS_WIDTH = 1000;

export default class {
  constructor() {
    this.format = 'hh:mm:ss';
    this.name = 'Untitled';
    this.customClass = undefined;
    this.waveOutlineColor = undefined;
    this.gain = 1;
    this.fades = {};
    this.peakData = {
      type: 'WebAudio',
      mono: false,
    };

    this.cueIn = 0;
    this.cueOut = 0;
    this.duration = 0;
    this.startTime = 0;
    this.endTime = 0;
    this.stereoPan = 0;
    this.speed = 1;
    this.bpm = null;
    this.currentBpm = null;
    this.currentBpmPercent = 1;
    this.fades = [];
    this.loopData = [];
  }

  setEventEmitter(ee) {
    this.ee = ee;
  }

  setName(name) {
    this.name = name;
  }

  setCustomClass(className) {
    this.customClass = className;
  }

  setWaveOutlineColor(color) {
    this.waveOutlineColor = color;
  }

  setCues(cueIn, cueOut) {
    if (cueOut < cueIn) {
      throw new Error('cue out cannot be less than cue in');
    }

    this.cueIn = cueIn;
    this.cueOut = cueOut;
    this.duration = this.cueOut - this.cueIn;
    this.endTime = this.startTime + this.duration;
  }

  /*
   *   start, end in seconds relative to the entire playlist.
   */
  trim(start, end) {
    const trackStart = this.getStartTime();
    const trackEnd = this.getEndTime();
    const offset = this.cueIn - trackStart;

    if (
      (trackStart <= start && trackEnd >= start) ||
      (trackStart <= end && trackEnd >= end)
    ) {
      const cueIn = start < trackStart ? trackStart : start;
      const cueOut = end > trackEnd ? trackEnd : end;

      this.setCues(cueIn + offset, cueOut + offset);
      if (start > trackStart) {
        this.setStartTime(start);
      }
    }
  }

  clone(start, end, times, sampleRate, ac) {
    const trackStart = this.getStartTime();
    const trackEnd = this.getEndTime();

    if (
        (trackStart <= start && trackEnd >= start) ||
        (trackStart <= end && trackEnd >= end)
    ) {
      const cueIn = start < trackStart ? trackStart : start;
      const cueOut = end > trackEnd ? trackEnd : end;
      const copyStartIndex = secondsToSamples(cueIn - trackStart, sampleRate);
      const copyEndIndex = secondsToSamples(cueOut - trackStart, sampleRate);
      const duration = (copyEndIndex - copyStartIndex) + 1;
      const buffer = [];
      if (cueIn > trackStart) {
        buffer.push(audioBufferUtil.slice(this.buffer, 0, copyStartIndex));
      }
      buffer.push(audioBufferUtil.repeat(
          audioBufferUtil.slice(this.buffer, copyStartIndex, copyEndIndex), times));
      if (cueIn < trackEnd) {
        buffer.push(audioBufferUtil.slice(this.buffer, copyEndIndex));
      }

      if (!this.loopData || this.loopData.length > 0) {
        this.loopData = [];
      }

      for (let time = 0; time < times - 1; time++) {
        this.loopData.push({
          start: copyEndIndex + 1 + (duration * time),
          end: copyEndIndex + (duration * (time + 1)),
        });
      }

      this.buffer = audioBufferUtil.concat(buffer);
      const offset = (cueOut - cueIn) * (times - 1);
      this.setCues(0, trackEnd - trackStart + offset);
      this.setPlayout(new Playout(ac, this.buffer));
    }
  }

  copy(start, end, sampleRate) {
    const trackStart = this.getStartTime();
    const trackEnd = this.getEndTime();

    if (
      (trackStart <= start && trackEnd >= start) ||
      (trackStart <= end && trackEnd >= end)
    ) {
      const cueIn = start < trackStart ? trackStart : start;
      const cueOut = end > trackEnd ? trackEnd : end;
      const copyStartIndex = secondsToSamples(cueIn - trackStart, sampleRate);
      const copyEndIndex = secondsToSamples(cueOut - trackStart, sampleRate);

      return audioBufferUtil.slice(this.buffer, copyStartIndex, copyEndIndex);
    }

    return null;
  }

  cut(start, end, sampleRate, ac) {
    const buffer = this.copy(start, end, sampleRate);

    const trackStart = this.getStartTime();
    const trackEnd = this.getEndTime();

    if (
      (trackStart <= start && trackEnd >= start) ||
      (trackStart <= end && trackEnd >= end)
    ) {
      const cueIn = start < trackStart ? trackStart : start;
      const cueOut = end > trackEnd ? trackEnd : end;
      const copyStartIndex = secondsToSamples(cueIn - trackStart, sampleRate);
      const copyEndIndex = secondsToSamples(cueOut - trackStart, sampleRate);

      const newBuffer = [];
      if (cueIn > trackStart) {
        newBuffer.push(audioBufferUtil.slice(this.buffer, 0, copyStartIndex - 1));
      }
      if (cueIn < trackEnd) {
        newBuffer.push(audioBufferUtil.slice(this.buffer, copyEndIndex + 1));
      }

      this.buffer = audioBufferUtil.concat(newBuffer);
      const offset = cueOut - cueIn;
      this.setCues(0, trackEnd - trackStart - offset);
      this.setPlayout(new Playout(ac, this.buffer));
    }

    return buffer;
  }

  paste(cueIn, cueOut, sampleRate, buffer, ac) {
    const trackStart = this.getStartTime();
    const trackEnd = this.getEndTime();
    const pasteIndex = secondsToSamples(cueOut < trackStart ? 0 : cueOut - trackStart, sampleRate);
    const newBuffer = [];
    const cueInOffset = trackStart - cueIn - buffer.duration;
    const cueOutOffset = cueOut - trackEnd;
    if (cueOut > trackStart && cueOut < trackEnd) {
      newBuffer.push(audioBufferUtil.slice(this.buffer, 0, pasteIndex));
    }

    if (cueOut > trackEnd) {
      newBuffer.push(this.buffer);
      if (cueOutOffset > 0) {
        newBuffer.push(audioBufferUtil.create(
          secondsToSamples(cueOutOffset, sampleRate)));
      }
    }
    newBuffer.push(buffer);
    if (cueOut < trackStart && cueInOffset > 0) {
      newBuffer.push(audioBufferUtil.create(
        secondsToSamples(cueInOffset, sampleRate)));
    }
    if (cueOut < trackEnd) {
      newBuffer.push(audioBufferUtil.slice(this.buffer, pasteIndex));
    }

    this.buffer = audioBufferUtil.concat(newBuffer);

    this.startTime = cueOut < trackStart ? cueIn : trackStart;
    if (cueIn >= trackStart && cueOutOffset < 0) {
      this.endTime = trackEnd + buffer.duration;
    } else if (cueInOffset < 0 && cueIn < trackStart) {
      this.endTime = trackEnd - cueInOffset;
    } else if (cueOut > trackEnd) {
      this.endTime = cueOut + buffer.duration;
    } else {
      this.endTime = trackEnd;
    }

    this.cueIn = 0;
    this.cueOut = this.endTime;
    this.duration = this.cueOut - this.cueIn;
    this.setPlayout(new Playout(ac, this.buffer));
  }

  setStartTime(start) {
    this.startTime = start;
    this.endTime = start + this.duration;
  }

  setPlayout(playout) {
    this.playout = playout;
  }

  setOfflinePlayout(playout) {
    this.offlinePlayout = playout;
  }

  setEnabledStates(enabledStates = {}) {
    const defaultStatesEnabled = {
      cursor: true,
      fadein: true,
      fadeout: true,
      select: true,
      shift: true,
    };

    this.enabledStates = _assign({}, defaultStatesEnabled, enabledStates);
  }

  addFade(start, end, fromVolume, toVolume) {
    this.saveFadeA(start, end, fromVolume, toVolume);
  }

  clearFades() {
    if (this.fades) {
      _forOwn(_keys(this.fades), (key) => {
        this.removeFade(key);
      });
    }
  }

  setFadeIn(duration, shape = 'logarithmic') {
    if (duration > this.duration) {
      throw new Error('Invalid Fade In');
    }

    const fade = {
      shape,
      start: 0,
      end: duration,
    };

    if (this.fadeIn) {
      this.removeFade(this.fadeIn);
      this.fadeIn = undefined;
    }

    this.fadeIn = this.saveFade(FADEIN, fade.shape, fade.start, fade.end);
  }

  setFadeOut(duration, shape = 'logarithmic') {
    if (duration > this.duration) {
      throw new Error('Invalid Fade Out');
    }

    const fade = {
      shape,
      start: this.duration - duration,
      end: this.duration,
    };

    if (this.fadeOut) {
      this.removeFade(this.fadeOut);
      this.fadeOut = undefined;
    }

    this.fadeOut = this.saveFade(FADEOUT, fade.shape, fade.start, fade.end);
  }

  saveFade(type, shape, start, end) {
    const id = uuid.v4();

    this.fades[id] = {
      type,
      shape,
      start,
      end,
    };

    return id;
  }

  saveFadeA(start, end, volumeFrom, volumeTo) {
    const id = uuid.v4();

    this.fades[id] = {
      id,
      start,
      end,
      volumeFrom,
      volumeTo,
    };

    return id;
  }

  removeFade(id) {
    delete this.fades[id];
  }

  setBuffer(buffer) {
    this.buffer = buffer;
  }

  setPeakData(data) {
    this.peakData = data;
  }

  setSpeed(speed) {
    this.speed = speed;
  }

  getSpeed() {
    return this.speed;
  }

  calculatePeaks(samplesPerPixel, sampleRate) {
    const cueIn = secondsToSamples(this.cueIn, sampleRate);
    const cueOut = secondsToSamples(this.cueOut, sampleRate);

    this.setPeaks(
      extractPeaks(
        this.buffer,
        samplesPerPixel,
        this.peakData.mono,
        cueIn,
        cueOut,
      ),
    );
  }

  setPeaks(peaks) {
    this.peaks = peaks;
  }

  setState(state) {
    this.state = state;

    if (this.state && this.enabledStates[this.state]) {
      const StateClass = stateClasses[this.state];
      this.stateObj = new StateClass(this);
    } else {
      this.stateObj = undefined;
    }
  }

  getStartTime() {
    return this.startTime;
  }

  getEndTime() {
    return this.endTime;
  }

  getDuration() {
    return this.duration;
  }

  isPlaying() {
    return this.playout.isPlaying();
  }

  setShouldPlay(bool) {
    this.playout.setShouldPlay(bool);
  }

  setBpm(bpm) {
    this.bpm = bpm;
  }

  getBpm() {
    return this.bpm;
  }

  setCurrentBpm(currentBpm) {
    this.currentBpm = currentBpm;
  }

  getCurrentBpm() {
    return this.currentBpm;
  }

  setCurrentBpmPercent(currentBpmPercent) {
    this.currentBpmPercent = currentBpmPercent;
  }

  getCurrentBpmPercent() {
    return this.currentBpmPercent;
  }

  setGainLevel(level) {
    this.gain = level;
    this.playout.setVolumeGainLevel(level);
  }

  setMasterGainLevel(level) {
    this.playout.setMasterGainLevel(level);
  }

  setStereoPanValue(value) {
    this.stereoPan = value;
    this.playout.setStereoPanValue(value);
  }

  /*
    startTime, endTime in seconds (float).
    segment is for a highlighted section in the UI.

    returns a Promise that will resolve when the AudioBufferSource
    is either stopped or plays out naturally.
  */
  schedulePlay(now, startTime, endTime, config) {
    let start;
    let duration;
    let when = now;
    let segment = endTime ? endTime - startTime : undefined;

    const defaultOptions = {
      shouldPlay: true,
      masterGain: 1,
      isOffline: false,
    };

    const options = _assign({}, defaultOptions, config);
    const playoutSystem = options.isOffline
      ? this.offlinePlayout
      : this.playout;

    // 1) track has no content to play.
    // 2) track does not play in this selection.
    if (
      this.endTime <= startTime ||
      (segment && startTime + segment < this.startTime)
    ) {
      // return a resolved promise since this track is technically "stopped".
      return Promise.resolve();
    }

    // track should have something to play if it gets here.

    // the track starts in the future or on the cursor position
    if (this.startTime >= startTime) {
      start = 0;
      // schedule additional delay for this audio node.
      when += (this.startTime - startTime) / this.speed;

      if (endTime) {
        segment -= this.startTime - startTime;
        duration = Math.min(segment, this.duration);
      } else {
        duration = this.duration;
      }
    } else {
      start = startTime - this.startTime;

      if (endTime) {
        duration = Math.min(segment, this.duration - start);
      } else {
        duration = this.duration - start;
      }
    }

    start += this.cueIn;
    const relPos = this.startTime;
    const sourcePromise = playoutSystem.setUpSource();

    _forOwn(this.fades, (fade) => {
      const fadeStart = now + (((relPos + fade.start) - startTime) / this.speed);

      if (fadeStart >= 0) {
        playoutSystem.applyFadeA(fadeStart, fade.end - fade.start, fade.volumeFrom, fade.volumeTo);
      }
    });

    playoutSystem.setSpeed(this.speed);
    playoutSystem.setVolumeGainLevel(this.gain);
    playoutSystem.setShouldPlay(options.shouldPlay);
    playoutSystem.setMasterGainLevel(options.masterGain);
    playoutSystem.setStereoPanValue(this.stereoPan);
    playoutSystem.play(when, start, duration);

    return sourcePromise;
  }

  scheduleStop(when = 0) {
    this.playout.stop(when);
  }

  renderOverlay(data) {
    const channelPixels = secondsToPixels(
      data.playlistLength,
      data.resolution,
      data.sampleRate,
    );

    const config = {
      attributes: {
        style: `position: absolute; top: 0; right: 0; bottom: 0; left: 0; width: ${channelPixels}px; z-index: 9;`,
      },
    };

    let overlayClass = '';

    if (this.stateObj) {
      this.stateObj.setup(data.resolution, data.sampleRate);
      const StateClass = stateClasses[this.state];
      const events = StateClass.getEvents();

      events.forEach((event) => {
        config[`on${event}`] = this.stateObj[event].bind(this.stateObj);
      });

      overlayClass = StateClass.getClass();
    }
    // use this overlay for track event cursor position calculations.
    return h(`div.playlist-overlay${overlayClass}`, config);
  }

  renderControls(data) {
    const muteClass = data.muted ? '.active' : '';
    const soloClass = data.soloed ? '.active' : '';
    const isCollapsed = data.collapsed;
    const numChan = this.peaks.data.length;
    const widgets = data.controls.widgets;

    const removeTrack = h(
      'button.btn.btn-danger.btn-sm.track-remove',
      {
        attributes: {
          type: 'button',
          title: 'Remove track',
        },
        onclick: () => {
          this.ee.emit('removeTrack', this);
        },
      },
      // [h('i.fas.fa-times')],
      ['Remove'],
    );

    const trackTitle = this.name + (this.bpm ? ` - ${Math.round(this.bpm * this.currentBpmPercent)} (${Math.round((this.currentBpm / this.bpm) * 10000) / 100}%)` : '');
    const trackName = h(
      'span',
      [`${trackTitle}`],
    );

    const collapseTrack = h(
      'button.btn.btn-info.btn-sm.track-collapse',
      {
        attributes: {
          type: 'button',
          title: isCollapsed ? 'Expand track' : 'Collapse track',
        },
        onclick: () => {
          this.ee.emit('changeTrackView', this, {
            collapsed: !isCollapsed,
          });
        },
      },
      [h(`i.fas.${isCollapsed ? 'fa-caret-down' : 'fa-caret-up'}`)],
    );

    const headerChildren = [];

    if (widgets.remove) {
      headerChildren.push(removeTrack);
    }
    headerChildren.push(trackName);
    if (widgets.collapse) {
      headerChildren.push(collapseTrack);
    }

    const controls = [
      h('div.track-header', headerChildren),
    ];

    if (!isCollapsed) {
      if (widgets.muteOrSolo) {
        controls.push(
          h('div.btn-group', [
            h(
              `button.btn.btn-outline-dark.btn-xs.btn-mute${muteClass}`,
              {
                attributes: {
                  type: 'button',
                },
                onclick: () => {
                  this.ee.emit('mute', this);
                },
              },
              ['Mute'],
            ),
            h(
              `button.btn.btn-outline-dark.btn-xs.btn-solo${soloClass}`,
              {
                onclick: () => {
                  this.ee.emit('solo', this);
                },
              },
              ['Solo'],
            ),
          ]),
        );
      }

      if (widgets.volume) {
        controls.push(
          h('label.volume', [
            h('input.volume-slider', {
              attributes: {
                'aria-label': 'Track volume control',
                type: 'range',
                min: 0,
                max: 100,
                value: 100,
              },
              hook: new VolumeSliderHook(this.gain),
              oninput: (e) => {
                this.ee.emit('volumechange', e.target.value, this);
              },
            }),
          ]),
        );
      }

      if (widgets.stereoPan) {
        controls.push(
          h('label.stereopan', [
            h('input.stereopan-slider', {
              attributes: {
                'aria-label': 'Track stereo pan control',
                type: 'range',
                min: -100,
                max: 100,
                value: 100,
              },
              hook: new StereoPanSliderHook(this.stereoPan),
              oninput: (e) => {
                this.ee.emit('stereopan', e.target.value / 100, this);
              },
            }),
          ]),
        );
      }
    }

    return h(
      'div.controls',
      {
        attributes: {
          style: `height: ${numChan * data.height}px; width: ${
            data.controls.width
          }px; position: absolute; left: 0; z-index: 10;`,
        },
      },
      controls,
    );
  }

  render(data) {
    const width = this.peaks.length;
    const playbackX = secondsToPixels(
      data.playbackSeconds,
      data.resolution,
      data.sampleRate,
    );
    const startX = secondsToPixels(
      this.startTime,
      data.resolution,
      data.sampleRate,
    );
    const endX = secondsToPixels(
      this.endTime,
      data.resolution,
      data.sampleRate,
    );
    let progressWidth = 0;
    const numChan = this.peaks.data.length;
    const scale = Math.floor(window.devicePixelRatio);

    if (playbackX > 0 && playbackX > startX) {
      if (playbackX < endX) {
        progressWidth = playbackX - startX;
      } else {
        progressWidth = width;
      }
    }

    const waveformChildren = [
      h('div.cursor', {
        attributes: {
          style: `position: absolute; width: 1px; margin: 0; padding: 0; top: 0; left: ${playbackX}px; bottom: 0; z-index: 5;`,
        },
      }),
    ];

    const channels = Object.keys(this.peaks.data).map((channelNum) => {
      const channelChildren = [
        h('div.channel-progress', {
          attributes: {
            style: `position: absolute; width: ${progressWidth}px; height: ${data.height}px; z-index: 2;`,
          },
        }),
      ];
      let offset = 0;
      let totalWidth = width;
      const peaks = this.peaks.data[channelNum];

      while (totalWidth > 0) {
        const currentWidth = Math.min(totalWidth, MAX_CANVAS_WIDTH);
        const canvasColor = this.waveOutlineColor
          ? this.waveOutlineColor
          : data.colors.waveOutlineColor;

        channelChildren.push(
          h('canvas', {
            attributes: {
              width: currentWidth * scale,
              height: data.height * scale,
              style: `float: left; position: relative; margin: 0; padding: 0; z-index: 3; width: ${currentWidth}px; height: ${data.height}px;`,
            },
            hook: new CanvasHook(
              peaks,
              offset,
              this.peaks.bits,
              canvasColor,
              scale,
              data.height,
            ),
          }),
        );

        totalWidth -= currentWidth;
        offset += MAX_CANVAS_WIDTH;
      }

      // if there are fades, display them.
      if (this.fadeIn) {
        const fadeIn = this.fades[this.fadeIn];
        const fadeWidth = secondsToPixels(
          fadeIn.end - fadeIn.start,
          data.resolution,
          data.sampleRate,
        );

        channelChildren.push(
          h(
            'div.wp-fade.wp-fadein',
            {
              attributes: {
                style: `position: absolute; height: ${data.height}px; width: ${fadeWidth}px; top: 0; left: 0; z-index: 4;`,
              },
            },
            [
              h('canvas', {
                attributes: {
                  width: fadeWidth,
                  height: data.height,
                },
                hook: new FadeCanvasHook(
                  fadeIn.type,
                  fadeIn.shape,
                  fadeIn.end - fadeIn.start,
                  data.resolution,
                ),
              }),
            ],
          ),
        );
      }

      if (this.fadeOut) {
        const fadeOut = this.fades[this.fadeOut];
        const fadeWidth = secondsToPixels(
          fadeOut.end - fadeOut.start,
          data.resolution,
          data.sampleRate,
        );

        channelChildren.push(
          h(
            'div.wp-fade.wp-fadeout',
            {
              attributes: {
                style: `position: absolute; height: ${data.height}px; width: ${fadeWidth}px; top: 0; right: 0; z-index: 4;`,
              },
            },
            [
              h('canvas', {
                attributes: {
                  width: fadeWidth,
                  height: data.height,
                },
                hook: new FadeCanvasHook(
                  fadeOut.type,
                  fadeOut.shape,
                  fadeOut.end - fadeOut.start,
                  data.resolution,
                ),
              }),
            ],
          ),
        );
      }

      return h(
        `div.channel.channel-${channelNum}`,
        {
          attributes: {
            style: `height: ${data.height}px; width: ${width}px; top: ${
              channelNum * data.height
            }px; left: ${startX}px; position: absolute; margin: 0; padding: 0; z-index: 1;`,
          },
        },
        channelChildren,
      );
    });

    waveformChildren.push(channels);
    waveformChildren.push(this.renderOverlay(data));

    // draw cursor selection on active track.
    if (data.isActive === true) {
      const cStartX = secondsToPixels(
        data.timeSelection.start,
        data.resolution,
        data.sampleRate,
      );
      const cEndX = secondsToPixels(
        data.timeSelection.end,
        data.resolution,
        data.sampleRate,
      );
      const cWidth = (cEndX - cStartX) + 1;
      const cClassName = cWidth > 1 ? '.segment' : '.point';

      waveformChildren.push(
        h(`div.selection${cClassName}`, {
          attributes: {
            style: `position: absolute; width: ${cWidth}px; bottom: 0; top: 0; left: ${cStartX}px; z-index: 4;`,
          },
        }),
      );
      if (cWidth > 1) {
        waveformChildren.push(
          h('div.track-selection', {
            attributes: {
              style: `position: absolute; width: ${cWidth}px; bottom: 0; top: 0; left: ${cStartX}px; z-index: 4;`,
            },
          },
        ));
        waveformChildren.push(
          h('div.track-selection-hoverable', {
            attributes: {
              style: `position: absolute; width: ${cWidth}px; bottom: 0; top: 0; left: ${cStartX}px; z-index: 4;`,
            } },
            h('span.tooltip', `${cueFormatters(this.format)(data.timeSelection.start)} - ${cueFormatters(this.format)(data.timeSelection.end)}`),
          ));
      }
    }

    const waveform = h(
      'div.waveform',
      {
        attributes: {
          style: `height: ${numChan * data.height}px; position: relative;`,
        },
      },
      waveformChildren,
    );

    const channelChildren = [];
    let channelMargin = 0;

    if (data.controls.show) {
      channelChildren.push(this.renderControls(data));
      channelMargin = data.controls.width;
    }

    channelChildren.push(waveform);

    const audibleClass = data.shouldPlay ? '' : '.silent';
    const customClass =
      this.customClass === undefined ? '' : `.${this.customClass}`;

    return h(
      `div.channel-wrapper${audibleClass}${customClass}`,
      {
        attributes: {
          style: `margin-left: ${channelMargin}px; height: ${
            data.height * numChan
          }px;`,
        },
      },
      channelChildren,
    );
  }

  getTrackDetails(includeBuffer) {
    const info = {
      src: this.src,
      start: this.startTime,
      end: this.endTime,
      name: this.name,
      customClass: this.customClass,
      cuein: this.cueIn,
      cueout: this.cueOut,
      stereoPan: this.stereoPan,
      gain: this.gain,
      buffer: includeBuffer ? this.buffer : null,
      bpm: this.bpm,
      currentBpm: this.currentBpm,
      currentBpmPercent: this.currentBpmPercent,
    };

    if (this.fadeIn) {
      const fadeIn = this.fades[this.fadeIn];

      info.fadeIn = {
        shape: fadeIn.shape,
        duration: fadeIn.end - fadeIn.start,
      };
    }

    if (this.fadeOut) {
      const fadeOut = this.fades[this.fadeOut];

      info.fadeOut = {
        shape: fadeOut.shape,
        duration: fadeOut.end - fadeOut.start,
      };
    }

    return info;
  }

  buildGainNode(data = []) {
    if (data) {
      this.clearFades();

      for (let i = 0; i < data.length - 1; i++) {
        const item = data[i];
        const nextItem = data[i + 1];

        this.addFade(item.time, nextItem.time, item.value / 100, nextItem.value / 100);
      }
    }
  }

  clearLoop() {
    if (this.loopData && this.loopData.length > 0) {
      this.loopData.length = 0;
    }
  }

  undoLoop(sampleRate, ac) {
    if (this.loopData && this.loopData.length > 0) {
      const trackEnd = this.getEndTime();
      const lastPiece = this.loopData.pop();
      let buffer = audioBufferUtil.slice(this.buffer, 0, lastPiece.start);
      if (lastPiece.end < this.buffer.length) {
        buffer = audioBufferUtil.concat(buffer,
            audioBufferUtil.slice(this.buffer, lastPiece.end));
      }
      this.buffer = buffer;
      this.setCues(0, trackEnd - samplesToSeconds(lastPiece.end - lastPiece.start, sampleRate));
      this.setPlayout(new Playout(ac, this.buffer));

      return true;
    }
    return false;
  }

}
