export function samplesToSeconds(samples, sampleRate) {
  return samples / sampleRate;
}

export function secondsToSamples(seconds, sampleRate) {
  return Math.ceil(seconds * sampleRate);
}

export function samplesToPixels(samples, resolution) {
  return Math.floor(samples / resolution);
}

export function pixelsToSamples(pixels, resolution) {
  return Math.floor(pixels * resolution);
}

export function pixelsToSeconds(pixels, resolution, sampleRate) {
  return (pixels * resolution) / sampleRate;
}

export function secondsToPixels(seconds, resolution, sampleRate) {
  return Math.ceil((seconds * sampleRate) / resolution);
}

export function cueFormatters(format) {

  function clockFormat(seconds, decimals) {
    var hours,
        minutes,
        secs,
        result;

    hours = parseInt(seconds / 3600, 10) % 24;
    minutes = parseInt(seconds / 60, 10) % 60;
    secs = seconds % 60;
    secs = secs.toFixed(decimals);

    result = (hours < 10 ? "0" + hours : hours) + ":" + (minutes < 10 ? "0" + minutes : minutes) + ":" + (secs < 10 ? "0" + secs : secs);

    return result;
  }

  var formats = {
    "seconds": function (seconds) {
      return seconds.toFixed(0);
    },
    "thousandths": function (seconds) {
      return seconds.toFixed(3);
    },
    "hh:mm:ss": function (seconds) {
      return clockFormat(seconds, 0);
    },
    "hh:mm:ss.u": function (seconds) {
      return clockFormat(seconds, 1);
    },
    "hh:mm:ss.uu": function (seconds) {
      return clockFormat(seconds, 2);
    },
    "hh:mm:ss.uuu": function (seconds) {
      return clockFormat(seconds, 3);
    }
  };

  return formats[format];
}
