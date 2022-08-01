if (window.parent.id === undefined) {
    window.parent.id = 0;
} else window.parent.id ++;

// Stands for audio player
class AP {
    #bpm = 60;
    #lenScale = 1;
    #tempo = 1000;
    #curNote = 0;
    #keepPlayingFile = null;
    #osc = null;
    #promise = null;
    
    constructor(settings = {instrument: 'sine', volumeCorrection: false}, ac = new (window.AudioContext || window.webkitAudioContext)()) {
        AP.#acs.push(this.ac = ac); // The audio context to work with
        
        this.id = window.parent.id;
        
        this.notes = [];
        this.instrument = settings.instrument;
        this.waveform = settings.waveform;
        this.fileBuffer = null;
        this.contains = null; // What this has (files or notes)
        this.playing = null; // What is currently playing
        this.paused = false;
        this.replayAt = 0; // When to resume in a file
        this.loop = null; // Called over and over again
        this.locked = false; // Can't change things when something is playing
        this.volumeCorrection = settings.volumeCorrection;
        
        this.compressor = new DynamicsCompressorNode(this.ac);
        this.compressor.threshold.setValueAtTime(-50, this.ac.currentTime);
        // this.compressor.knee.setValueAtTime(10, this.ac.currentTime);
        // this.compressor.ratio.setValueAtTime(20, this.ac.currentTime);
        // this.compressor.attack.setValueAtTime(0.001, this.ac.currentTime);
        // this.compressor.release.setValueAtTime(1, this.ac.currentTime);
        
        
        Object.defineProperty(this, 'bpm', {
            get() {
                return this.#bpm;
            },
            set(bpm) {
                this.#bpm = bpm;
                this.#lenScale = 240 / bpm;
                this.#tempo = this.#lenScale * 1000;
            }
        }); // Creates a getter/setter for the bpm
    }
    loadNotes(notes) {
        if (this.locked) {
            throw new Error('Tried to change notes when locked.');
            return;
        }
        
        this.contains = 'notes';
        this.notes = notes;
    }
    async loadFile(file) {
        if (this.locked) {
            throw new Error('Tried to change file when locked.');
            return;
        }
        
        this.contains = 'files';
        
        if (file instanceof File) {
            this.fileBuffer = await AP.getFileBuffer(file);
        } else this.fileBuffer = file;
    }
    
    play = (first = true, offset) => { // Has to be an arrow function to keep the 'this' the same
        
        if (this.locked && first) {
            throw new Error('Tried to play while locked.');
            return;
        }
        
        if (this.contains === 'files') {
            this.locked = true;
            this.startedAt = Date.now();
            this.playing = new AudioBufferSourceNode(this.ac, {
                buffer: this.fileBuffer,
                playbackRate: this.#bpm / 60,
            });
            
            this.playing.connect(this.ac.destination);
            this.playing.start(this.ac.currentTime, offset);
            
            this.#keepPlayingFile = window.requestAnimationFrame(() => this.checkEnd());
            
            this.playing.addEventListener('ended', e => !this.paused && this.finish());
        } else {
            if (!this.notes.length) return;
            
            this.locked = true;
            if (this.#curNote < this.notes.length) {
                let tempNote = this.#curNote,
                    chordNum = 0; // Number of notes in the chord
                while(this.notes[tempNote] === 0) { // Look to see how many notes in a chord
                    tempNote += 3;
                    chordNum ++;
                }
                if (!chordNum) chordNum = 1; // Always will be at least one note
                
                this.loop = window.setTimeout(() => {this.play(false)}, this.#tempo / this.notes[this.#curNote]); // Put the next note in the queue
                
                if (this.notes[this.#curNote + 1] === null) { // If it is a rest, stop
                    this.#curNote += 3;
                    return;
                }
                
                // Play all of the notes in the chord at once
                for (let i = chordNum; i --;) {
                    const len = 1 / this.notes[this.#curNote + 1] * this.#lenScale,
                        pitch = this.notes[this.#curNote + 2];
                    
                    const osc = new OscillatorNode(this.ac, {
                        type: this.instrument,
                        frequency: 261.6255 * Math.pow(2, pitch / 12),
                        periodicWave: this.waveform,
                    });
                    this.#osc = osc;
                    
                    let cVolume = ((-pitch + 43) / 40) ** 3 + 0.1; // Lower notes are really hard to heard, but high notes are really loud. This corrects the volume for that
                    
                    if (cVolume > 1) cVolume = 1;
                    
                    // len += 0.1;
                    
                    const env = new GainNode(this.ac); // Envelope
                    env.gain.cancelScheduledValues(this.ac.currentTime);
                    env.gain.setValueAtTime(0, this.ac.currentTime);
                    env.gain.linearRampToValueAtTime(cVolume, this.ac.currentTime + len * 0.2); // Who comes up with these names? 23 characters for a single function call
                    env.gain.setValueAtTime(cVolume, this.ac.currentTime + len - len * 0.2);
                    env.gain.linearRampToValueAtTime(0, this.ac.currentTime + len);
                    
                    osc.connect(env).connect(this.compressor);
                    this.compressor.connect(this.ac.destination);
                    osc.start();
                    osc.stop(this.ac.currentTime + len);
                    
                    
                    this.#curNote += 3;
                    
                    if (this.#curNote >= this.notes.length) this.finishTimer = window.setTimeout(this.finish, this.#tempo / this.notes[this.notes.length - 2]);
                }
            }
        }
    }
    pause() {
        this.paused = true;
        if (this.contains === 'files') {
            this.replayAt += (Date.now() - this.startedAt) / 1000;
            this.playing.stop();
        } else {
            if (this.#curNote >= 3) {
                this.#curNote -= 3;
            } else this.curNote = 0;
            
            this?.#osc?.stop();
            
            window.clearTimeout(this.loop);
            window.clearTimeout(this.finishTimer);
        }
        
        this.locked = false;
    }
    resume() {
        this.paused = false;
        this.play(this.replayAt);
    }
    end() {
        this.pause();
        this.notes = [];
        this.fileBuffer = null;
        this.contains = null;
        this.playing = null;
        this.paused = false;
        this.replayAt = 0;
        this.loop = null;
        
        this.#curNote = 0;
    }
    
    finish = () => {
        this.pause();
        this.locked = false;
        this.playing = null;
        this.paused = false;
        this.replayAt = 0;
        this.loop = null;
        
        this.#curNote = 0;
        
        if (this.onEnd) {
            this.onEnd = this.onEnd.bind(window); // Don't want it to get access to the private properties
            this.onEnd();
        }
    }
    
    checkEnd = () => {
        if (this.id === window.parent.id) {
            window.requestAnimationFrame(() => this.checkEnd());
        } else {
            this.end();
        }
    }
    
    static #ac = new (window.AudioContext || window.webkitAudioContext)(); // Used for static methods
    static #acs = [];
    static resumeAll = () => {
        for (const ac of AP.#acs) ac.resume();
    }
    static async getFileBuffer(file) {
        return await AP.#ac.decodeAudioData(await file.arrayBuffer());
    }
}
window.addEventListener('mousedown', AP.resumeAll, {
    once: true,
    capture: true,
});
