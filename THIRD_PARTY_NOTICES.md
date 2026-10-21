# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`).

Its Robonect client (`src/robonect/client.js`, the paths, status codes and
modes of `src/constants.js`) is a JavaScript port of parts of
**aiorobonect** 1.3.1 (<https://github.com/geertmeersman/aiorobonect>), the
Python library of the Robonect integration for Home Assistant, and of the
field paths and status mappings of that integration
(<https://github.com/geertmeersman/robonect>): the `/json?cmd=` commands
(`status`, `start`, `stop`, `mode`), the HTTP Basic authentication, the
status, mode and error fields. No Python code runs here and neither project
is a dependency. Both carry the same license:

```
MIT License

Copyright (c) 2023 Geert Meersman

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The test fixtures (`test/fixtures/fakeRobonect.js`) follow the field paths
those projects read; their values are made up.

Robonect, Husqvarna, Automower, Gardena, Flymo and McCulloch are trademarks
of their owners. This project is not affiliated with, endorsed by or
supported by any of them.
