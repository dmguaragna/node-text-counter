const express = require('express');
const axios = require("axios").default;
const { convert } = require('html-to-text');
const cors = require("cors");
const HTMLParser = require('node-html-parser');
const WAE = require('@rane/web-auto-extractor').default
const chromium = require('chrome-aws-lambda');
const { addExtra } = require('puppeteer-extra')
const puppeteerExtra = addExtra(chromium.puppeteer)
// const AdblockerPlugin = require("puppeteer-extra-plugin-adblocker");
// puppeteerExtra.use(AdblockerPlugin());
const randomUseragent = require('random-useragent');

const app = express();

app.use(express.json({limit: '100mb'}));
app.use(express.urlencoded({limit: '100mb', extended: true, parameterLimit: 50000}));

app.use(express.static('tools-develop/build'));
app.use(cors());

const user = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.75 Safari/537.36";

const clean = string => {
    const text = convert(string,{
      wordwrap: 130,
      selectors: [ {
        selector: 'a', options: { ignoreHref: true }
      }]
    });
    const innerText = text.replace(/[/*]/g, '');
    return innerText;
  }

const count = string => {
    let map = {}
    const words = string.split(" ").filter(word => word !== "")

    for (let i = 0; i < words.length; i++) {
      const item = words[i]
      map[item] = (map[item] + 1) || 1
    }
    return map;
}

const metaData = (data, string) => {
  var name = data.getAttribute('name') || data.getAttribute('property');
  if(name === string)
  {
    return data.getAttribute('content') || null;
  }
}

const typeDataCounter = (string) => {
  var microdata, rdfa, jsonld;
  var typeArray = [];

  if(Object.keys(string.microdata).length !== 0 && Object.keys(string.microdata) !== undefined)
  {
    microdata = Object.keys(string.microdata);
    for (var i = 0; i < microdata.length; i++) {
      if(microdata[i] !== "undefined")
        typeArray.push(microdata[i]);
    }
  }

  if(Object.keys(string.rdfa).length !== 0 && Object.keys(string.rdfa) !== undefined)
  {
    rdfa = Object.keys(string.rdfa);
    for (var i = 0; i < rdfa.length; i++) {
      if(rdfa[i] !== "undefined")
        typeArray.push(rdfa[i]);
    }

  }

  if(Object.keys(string.jsonld).length !== 0 && Object.keys(string.jsonld) !== undefined)
  {
    jsonld = Object.keys(string.jsonld);
    for (var i = 0; i < jsonld.length; i++) {
      if(jsonld[i] !== "undefined")
        typeArray.push(jsonld[i]);
    }
  }
  return typeArray;
}

var resultArray = [];
var errorArray = [];

const scrape = async url => {
  let browser;
  let response;

  let agent = randomUseragent.getRandom();
  try {
  browser = await puppeteerExtra.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath,
      headless: chromium.headless,
    });

      let page = await browser.newPage();
      await page.setUserAgent(agent);
      await page.setViewport({width: 1920, height: 1080});
      await page.setDefaultNavigationTimeout(0);
      await page.goto(url);
      response = await page.content();
    await page.close();
    await browser.close();

  var root, metas, title, canonical, html, hOnes, hTwos, lang, siteTitle, metaUrl, description, metaH1, hTwoSize, schemaType, type;
  let metaH2 = [];
  let filteredH2;

  if(!response.category)
    root = HTMLParser.parse(response);

  if(root !== undefined)
  {
    metas     = root.querySelectorAll('meta');
    title     = root.querySelector('title');
    canonical = root.querySelector('link[rel=canonical]');
    html      = root.querySelector('html');
    hOnes     = root.querySelectorAll('h1');
    hTwos     = root.querySelectorAll('h2');

    for (var i = 0; i < metas.length; i++) {
      var el = metas[i];
      ['title', 'description', 'image'].forEach(s => {
        const val = metaData(el, s);
        if (val) {
          metas[s] = val;
          description = metas[s];
        }
    });
    }

    for (var i = 0; i < hOnes.length; i++) {
      if(hOnes[i] !== undefined)
        metaH1 = hOnes[0].text;
    }

    for (var i = 0; i < hTwos.length; i++) {
      if(hTwos[i] !== undefined && hTwos[i] !== '')
        metaH2.push(hTwos[i].removeWhitespace().text);
    }

    hTwoSize = hTwos.length;

    filteredH2 = metaH2.filter(function(h2){
      return h2 !== '';
    }).splice(0,3);

    if (canonical)
      metaUrl = canonical.getAttribute('href');

    if(title !== null) {
      siteTitle = title.text;
    } else {
      siteTitle = 'site has no title';
    }

    if(html !== undefined && html !== null) {
      lang = html.getAttribute('lang');
    } else {
      lang = 'no lang';
    }

  } else {
    siteTitle = response.data.category.meta_title;
    description = response.data.category.meta_description;
    canonical = response.data.category.url;
    hTwoSize = 0;
    filteredH2 = 0;
  }

  var metaObj = {
    title: siteTitle,
    description: description || "site has no description!",
    url: metaUrl || "missing canonical url!",
    lang: lang || 'html lang not defined',
    h1: metaH1 || "missing h1 tag!",
    h2: {
      size: hTwoSize,
      filtered: filteredH2
    }
  }

  var cleanedContent = clean(response);
  var counter = count(cleanedContent);
  var counterValues = Object.values(counter);
  var total = 0;

  for (var x = 0; x < counterValues.length; x++) {
    total += parseInt(counterValues[x], 10);
  }
  var parsedUrl, parsedSiteName;
  var parsedSchema = WAE().parse(response);

  var dataCounter = typeDataCounter(parsedSchema);

  var schemaObject = {
      types: dataCounter || ""
  }

  var webPage = {
      meta: metaObj,
      site: url,
      total: total,
      text: '',
      schemaObject: schemaObject.types
  };

  resultArray.push(webPage);

  console.log("scrape function");
  console.log(webPage);
  return resultArray;
} catch (err) {
  console.log(err);
}
}

const fetchUrl = async url => {
    return await axios.get(url)
    .then(response => {
        var root, metas, title, canonical, html, hOnes, hTwos, lang, siteTitle, metaUrl, description, metaH1, hTwoSize, schemaType, type;
        let metaH2 = [];
        let filteredH2;

        if(!response.data.category)
          root = HTMLParser.parse(response.data);

        if(root !== undefined)
        {
          metas     = root.querySelectorAll('meta');
          title     = root.querySelector('title');
          canonical = root.querySelector('link[rel=canonical]');
          html      = root.querySelector('html');
          hOnes     = root.querySelectorAll('h1');
          hTwos     = root.querySelectorAll('h2');

          for (var i = 0; i < metas.length; i++) {
            var el = metas[i];
            ['title', 'description', 'image'].forEach(s => {
              const val = metaData(el, s);
              if (val) {
                metas[s] = val;
                description = metas[s];
              }
          });
          }

          for (var i = 0; i < hOnes.length; i++) {
            if(hOnes[i] !== undefined)
              metaH1 = hOnes[0].text;
          }

          for (var i = 0; i < hTwos.length; i++) {
            if(hTwos[i] !== undefined && hTwos[i] !== '')
              metaH2.push(hTwos[i].removeWhitespace().text);
          }

          hTwoSize = hTwos.length;

          filteredH2 = metaH2.filter(function(h2){
            return h2 !== '';
          }).splice(0,3);

          if (canonical)
            metaUrl = canonical.getAttribute('href');

          if(title !== null) {
            siteTitle = title.text;
          }
           else {
            siteTitle = 'site has no title';
          }

          if(html !== undefined && html !== null) {
            lang = html.getAttribute('lang');
          }
          else {
            lang = 'no lang';
          }

        }
        else
        {
          siteTitle = response.data.category.meta_title;
          description = response.data.category.meta_description;
          canonical = response.data.category.url;
          hTwoSize = 0;
          filteredH2 = 0;
        }

        var metaObj = {
          title: siteTitle,
          description: description || "site has no description!",
          url: metaUrl || "missing canonical url!",
          lang: lang || 'html lang not defined',
          h1: metaH1 || "missing h1 tag!",
          h2: {
            size: hTwoSize,
            filtered: filteredH2
          }
        }


        var cleanedContent = clean(response.data);
        var counter = count(cleanedContent);
        var counterValues = Object.values(counter);
        var total = 0;

        for (var x = 0; x < counterValues.length; x++) {
          total += parseInt(counterValues[x], 10);
        }


        var parsedUrl, parsedSiteName;
        var parsedSchema = WAE().parse(response.data);

        var dataCounter = typeDataCounter(parsedSchema);

        var schemaObject = {
            types: dataCounter || ""
        }

        var webPage = {
            meta: metaObj,
            site: response.config.url,
            total: total,
            text: '',
            schemaObject: schemaObject.types
        };
        if(total > 0)
        {
          resultArray.push(webPage);

        }
        // else
        // {
        //   scrape(response.config.url);
        // }
        // console.log(webPage);
        return resultArray;

    }).catch(error => {
      var errSite;

      if(error.response !== undefined)
        errSite = error.response.config.url;

      var errPage = {
        site: errSite,
        total: 'error',
        meta: "no meta data"
      }
      // scrape(errPage.site);
console.log(errPage);
      errorArray.push(errPage);
    });
  }

const promises = urlResults => {
  resultArray = [];
  errorArray = [];
  return urlResults.map(result => {
        return fetchUrl(result.link).catch(err => {
        console.log(err);
    });
  });
}
const puppeteerPromises = urlResults => {
  return urlResults.map(result => {
        return scrape(result.site).catch(err => {
        console.log(err);
    });
  });
}

app.post('/sendUrls', async (req, res, next) => {
      var urlResults = req.body;
      const promise = await promises(urlResults);

      for (const p of promise) {
        const result = await p;
      }
      console.log(errorArray);
      if(errorArray.length > 0) {
        const puppPromises = await puppeteerPromises(errorArray);
        console.log(puppPromises);
        for (const p of puppPromises) {
          const result = await p;
        }
      }
      console.log("timeout start");
      setTimeout(function() {
       console.log("result Array sent");
      res.send(resultArray);
    }, 2000);

});
app.get('/', (req,res) => {
  res.send("hello from node text-counter server");
});
const PORT = 5000;

app.listen(PORT, () => {
  console.log("Node server started on " + PORT);
});
