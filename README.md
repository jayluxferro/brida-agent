## BurpSuite & Frida (Brida) Agent

### How to compile & load

```sh
$ git clone https://github.com/jayluxferro/brida-agent.git
$ cd brida-agent/
$ npm install
$ frida -U -f com.example.android -l bridaGeneratedCompiledOutput.js
```

### Development workflow

To continuously recompile on change, keep this running in a terminal:

```sh
$ npm run watch
```

And use an editor like Visual Studio Code for code completion and instant
type-checking feedback.
