var fs = require("fs");
var async = require("async");
var traverse = require("traverse");
var google = require("google-translate");

var TRANSERR = {
  NOT_TRANSLATED: 1,
  IS_URL: 2
};

// RUN
const run = function(apiKey, dir, sourceLanguage, languages, includeHtml, finish) {

  const ggl = google(apiKey);

  // TRANSLATE
  const translate = function(text, language, callback) {

    // passthrough if contains HTML
    if (!includeHtml && /<[a-z][\s\S]*>/i.test(text) == true) {
      return callback(TRANSERR.NOT_TRANSLATED, text);
    }

    // it is just a url
    if (text.indexOf("http://") == 0 && text.indexOf(" ") < 0) {
      return callback(TRANSERR.IS_URL, text);
    }

    if (apiKey) {

      // fire the google translation
      ggl.translate(text, sourceLanguage, language, function(err, translation) {

        if (err) {
          return callback(TRANSERR.NOT_TRANSLATED, text);
        }

        // return the translated text
        return callback(null, translation.translatedText);
      });
    } else {

      // bypass translation
      return callback(null, text);
    }
  };

  // PROCESS FILE
  const processFile = function(file, callback) {
    // open file
    let f = file;
    fs.readFile(dir + sourceLanguage + '/' + f, function(err, data) {

      // bubble up error
      if (err) {
        return callback({
          "file": f,
          "error": err
        }, null);
      }

      data = data.toString();

      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch (e) {
        return callback({
          "file": f,
          "error": e
        }, null);
      }

      let traversed = traverse(parsed);

      let targets = {};

      // create targets for every language
      for (let l in languages) {
        let lang = languages[l];
        targets[lang] = traverse(traversed.clone());
      }

      // find all paths of the object keys recursively
      let paths = traversed.paths();

      // translate each path
      async.map(paths, function(path, done) {

        let text = traversed.get(path);

        // only continue for strings
        if (typeof(text) !== "string") {
          return done(null);
        }

        // translate every language for this path
        async.map(languages, function(language, translated) {

          // translate the text
          translate(text, language, function(err, translation) {

            // add new value to path
            targets[language].set(path, translation);

            let e = null;
            if (err === TRANSERR.NOT_TRANSLATED) {
              e = {
                "file": f,
                "path": path,
                "text": text,
                "source": sourceLanguage,
                "target": language
              };
            }

            return translated(null, e);
          });

          // all languages have been translated for this path,
          // so call the done callback of the map through all paths
        }, done);
      },
        // all are translated
        function(err, results) {
          // write translated targets to files
          for (let t in targets) {
            let transStr = JSON.stringify(targets[t].value, null, "\t");

            if (!fs.existsSync(dir + t)) {
              fs.mkdirSync(dir + t);
            }

            let p = dir + t + '/' + f;

            fs.writeFileSync(p, transStr);

            // add language to source file
            parsed[t] = true;
          }

          // filter out null results, to just return the not translated ones
          notTranslated = results.filter(function(item) {

            // check if array only contains nulls
            for (let i in item) {
              if (item[i] != null) {
                return true;
              }
            }

            return false;
          });

          // spice up error message
          if (err) {
            err = {
              "file": file,
              "error": err
            };
          }

          return callback(err, notTranslated);
        });
    });
  };

  // process the source files
  fs.readdir(dir + sourceLanguage, (err, files) => {
    if (err) return finish(err);
    files.forEach(function(file) {
      fs.stat(dir + sourceLanguage + '/' + file, function(err, stat) {
        if (err) {
          return finish(err, stat)
        }
        if (stat.isFile()) {
          processFile(file, function (err, results) {
            if (err) {
              return finish(err, results)
            }
          })
        }
      })
    })
  })
};

// EXPORTS
module.exports = {
  "run": run
}
