class ClickIntervalVoiceProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(Math.max(4096, Math.ceil(sampleRate * 0.14)));
    this.writeIndex = 0;
    this.phase = 0;
    this.pitch = 0;
    this.mix = 1;
    this.gateDb = -65;
    this.envelope = 0;
    this.gateGain = 0;
    this.gateOpen = false;
    this.gateHoldSamples = 0;
    this.pcAudioCancellation = false;
    this.voiceIsolation = false;
    this.isolationNoiseFloor = 0.003;
    this.isolationGain = 1;
    this.isolationPreviousInput = 0;
    this.isolationPreviousOutput = 0;
    this.echoRingSize = 8192;
    this.echoRingMask = this.echoRingSize - 1;
    this.echoReference = new Float32Array(this.echoRingSize);
    this.echoMicrophone = new Float32Array(this.echoRingSize);
    this.echoWriteIndex = 0;
    this.echoSamplesSeen = 0;
    this.echoDelay = Math.round(sampleRate * 0.025);
    this.echoDelayReady = false;
    this.echoFilter = new Float32Array(1);
    this.echoSearchCountdown = Math.round(sampleRate * 0.2);
    this.port.onmessage = event => {
      const value = event.data || {};
      if (Number.isFinite(value.pitch)) this.pitch = Math.max(-12, Math.min(12, value.pitch));
      if (Number.isFinite(value.mix)) this.mix = Math.max(0, Math.min(1, value.mix));
      if (Number.isFinite(value.gateDb)) this.gateDb = Math.max(-90, Math.min(-5, value.gateDb));
      if (typeof value.pcAudioCancellation === 'boolean' && value.pcAudioCancellation !== this.pcAudioCancellation) {
        this.pcAudioCancellation = value.pcAudioCancellation;
        this.echoFilter.fill(0);
      }
      if (typeof value.voiceIsolation === 'boolean') this.voiceIsolation = value.voiceIsolation;
    };
  }

  findEchoDelay() {
    if (this.echoSamplesSeen < this.echoRingSize) return;
    let bestDelay = this.echoDelay;
    let bestScore = 0;
    let bestGain = 0;
    const newest = (this.echoWriteIndex - 1) & this.echoRingMask;
    for (let delay = 128; delay <= 6144; delay += 32) {
      let correlation = 0;
      let microphonePower = 0;
      let referencePower = 0;
      for (let offset = 0; offset < 2048; offset += 8) {
        const microphone = this.echoMicrophone[(newest - offset) & this.echoRingMask];
        const reference = this.echoReference[(newest - offset - delay) & this.echoRingMask];
        correlation += microphone * reference;
        microphonePower += microphone * microphone;
        referencePower += reference * reference;
      }
      if (referencePower < 1e-5 || microphonePower < 1e-6) continue;
      const score = Math.abs(correlation) / Math.sqrt(referencePower * microphonePower);
      if (score > bestScore) {
        bestScore = score;
        bestDelay = delay;
        bestGain = correlation / referencePower;
      }
    }
    if (bestScore > 0.08 && (!this.echoDelayReady || Math.abs(bestDelay - this.echoDelay) <= 64)) {
      if (!this.echoDelayReady) this.echoFilter.fill(0);
      this.echoDelay = bestDelay;
      this.echoDelayReady = true;
      const measuredGain = Math.max(-2, Math.min(2, bestGain));
      this.echoFilter[0] = Math.abs(this.echoFilter[0]) < 0.001 ? measuredGain : this.echoFilter[0] * 0.85 + measuredGain * 0.15;
    }
  }

  cancelPcAudio(microphone, reference) {
    const writeIndex = this.echoWriteIndex;
    this.echoReference[writeIndex] = reference;
    this.echoMicrophone[writeIndex] = microphone;
    this.echoWriteIndex = (writeIndex + 1) & this.echoRingMask;
    this.echoSamplesSeen += 1;
    this.echoSearchCountdown -= 1;
    if (this.echoSearchCountdown <= 0) {
      this.echoSearchCountdown = Math.round(sampleRate * 0.2);
      this.findEchoDelay();
    }
    if (!this.pcAudioCancellation || this.echoSamplesSeen < this.echoDelay + this.echoFilter.length) return microphone;

    const baseIndex = (writeIndex - this.echoDelay) & this.echoRingMask;
    let estimatedEcho = 0;
    let referencePower = 1e-6;
    for (let tap = 0; tap < this.echoFilter.length; tap += 1) {
      const sample = this.echoReference[(baseIndex - tap) & this.echoRingMask];
      estimatedEcho += this.echoFilter[tap] * sample;
      referencePower += sample * sample;
    }
    const cleaned = microphone - estimatedEcho;
    return cleaned;
  }

  read(delay) {
    let position = this.writeIndex - delay;
    while (position < 0) position += this.buffer.length;
    const first = Math.floor(position) % this.buffer.length;
    const second = (first + 1) % this.buffer.length;
    const fraction = position - Math.floor(position);
    return this.buffer[first] * (1 - fraction) + this.buffer[second] * fraction;
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const referenceChannels = inputs[1] || [];
    const output = outputs[0];
    if (!output?.length) return true;
    const ratio = Math.pow(2, this.pitch / 12);
    const windowSize = Math.min(this.buffer.length - 16, Math.max(512, Math.round(sampleRate * 0.032)));
    const phaseStep = Math.abs(ratio - 1) / windowSize;
    const threshold = Math.pow(10, this.gateDb / 20);
    const length = output[0].length;
    let isolationTarget = 1;
    if (this.voiceIsolation && input?.length) {
      let blockEnergy = 0;
      for (let index = 0; index < input.length; index += 1) blockEnergy += (input[index] || 0) ** 2;
      const blockRms = Math.sqrt(blockEnergy / input.length);
      const floorRate = blockRms < this.isolationNoiseFloor * 1.8 ? 0.025 : 0.00005;
      this.isolationNoiseFloor += (blockRms - this.isolationNoiseFloor) * floorRate;
      this.isolationNoiseFloor = Math.max(0.00008, Math.min(0.04, this.isolationNoiseFloor));
      const isolationThreshold = Math.max(0.0005, this.isolationNoiseFloor * 2.2);
      const speechRatio = Math.max(0, Math.min(1, (blockRms - this.isolationNoiseFloor) / Math.max(0.0001, isolationThreshold - this.isolationNoiseFloor)));
      isolationTarget = Math.max(0.08, speechRatio * speechRatio);
    }

    for (let index = 0; index < length; index += 1) {
      const microphone = input ? input[index] || 0 : 0;
      let reference = 0;
      for (const channel of referenceChannels) reference += channel[index] || 0;
      if (referenceChannels.length) reference /= referenceChannels.length;
      let dry = this.cancelPcAudio(microphone, reference);
      if (this.voiceIsolation) {
        const highPassed = 0.991 * (this.isolationPreviousOutput + dry - this.isolationPreviousInput);
        this.isolationPreviousInput = dry;
        this.isolationPreviousOutput = highPassed;
        this.isolationGain += (isolationTarget - this.isolationGain) * (isolationTarget > this.isolationGain ? 0.02 : 0.001);
        dry = highPassed * this.isolationGain;
      } else {
        this.isolationGain += (1 - this.isolationGain) * 0.02;
      }
      this.buffer[this.writeIndex] = dry;
      const magnitude = Math.abs(dry);
      this.envelope += (magnitude - this.envelope) * (magnitude > this.envelope ? 0.025 : 0.00035);
      if (this.envelope >= threshold) {
        this.gateOpen = true;
        this.gateHoldSamples = Math.round(sampleRate * 0.12);
      } else if (this.gateOpen) {
        if (this.gateHoldSamples > 0) this.gateHoldSamples -= 1;
        else if (this.envelope < threshold * 0.5) this.gateOpen = false;
      }
      const gateTarget = this.gateOpen ? 1 : 0.08;
      this.gateGain += (gateTarget - this.gateGain) * (gateTarget ? 0.012 : 0.0003);

      let shifted = dry;
      if (Math.abs(this.pitch) > 0.01) {
        this.phase += phaseStep;
        if (this.phase >= 1) this.phase -= 1;
        const secondPhase = (this.phase + 0.5) % 1;
        const delayA = ratio >= 1 ? 8 + (1 - this.phase) * windowSize : 8 + this.phase * windowSize;
        const delayB = ratio >= 1 ? 8 + (1 - secondPhase) * windowSize : 8 + secondPhase * windowSize;
        const crossfade = 0.5 - 0.5 * Math.cos(this.phase * Math.PI * 2);
        const weightA = Math.sqrt(crossfade);
        const weightB = Math.sqrt(1 - crossfade);
        shifted = this.read(delayA) * weightA + this.read(delayB) * weightB;
      }

      const sample = (dry * (1 - this.mix) + shifted * this.mix) * this.gateGain;
      for (let channel = 0; channel < output.length; channel += 1) output[channel][index] = sample;
      this.writeIndex = (this.writeIndex + 1) % this.buffer.length;
    }
    return true;
  }
}

registerProcessor('click-interval-voice', ClickIntervalVoiceProcessor);
