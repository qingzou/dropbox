'use strict'

let express = require('express')
let morgan = require('morgan')
let path = require('path')
let fs = require('fs')
let nodeify = require('bluebird-nodeify')
let async = require ("async")
let mime = require('mime-types')
let rimraf = require('rimraf')
let mkdirp = require('mkdirp')
let jot = require('json-over-tcp')
let _ = require('lodash')

require('songbird')

const NODE_ENV = process.env.NODE_ENV
const PORT = process.env.PORT || 8000
const ROOT_DIR = path.resolve(process.cwd())



let TCP_LISTENING_PORT = 8099
let server = jot.createServer(TCP_LISTENING_PORT)
server.on('connection', newConnectionHandler)

let CLIENT_SOCKET

// Start listening
console.log(`TCP sync server listening at 127.0.0.1:${TCP_LISTENING_PORT}`)
server.listen(TCP_LISTENING_PORT)


console.log("reached here")


let app = express()

if(NODE_ENV === 'development') {
   app.use(morgan('dev'))
}

app.listen(PORT, ()=>console.log("LISTENING @ http://127.0.0.1:" + PORT))

app.get('*', setFilePath, sendHeaders, (req, res, next) => {
   res.end()
})

app.head('*',  setFilePath, sendHeaders, (req, res, next) => {
     res.end()

})


app.delete('*', setFilePath, fileDelete, (req, res, next) => res.end())

app.put('*', setFilePath, setDirDetails, (req, res, next) => {
    console.log('in put method')
    if(req.stat) return res.send(405, 'file exists')
    mkdirp.promise(req.dirPath, function(){
       next()
    })
    if(!req.isDir) {
        console.log('request is for file' + req.filePath)
        req.promise.pipe(fs.createWriteStream(req.filePath))
        console.log('after request  is written to file' )
        if (CLIENT_SOCKET) {
                console.log('inside function2')
                let buffer = fs.promise.readFile(req.filePath)

                buffer.then(function (data) {
                    console.log('data is ' + data)
                    CLIENT_SOCKET.write({
                          "action": "create",
                          "path": req.url,
                          "type": "file",
                          "contents": data.toString("base64"),
                          "updated": null
                          })
                })




        }
    }
    res.end()
})

app.post('*', setFilePath, setDirDetails, (req, res, next) => {
    console.log('in post method')
    if(!req.stat) return res.send(405, 'file does not exists')
    if(req.isDir) return res.send(405, 'Path is a directory')
    fs.promise.truncate(req.filePath, 0, function() {
        next()
    })
    req.pipe(fs.createWriteStream(req.filePath))
    res.end()
})

function setFilePath(req, res, next) {
    console.log('in set file path')
    req.filePath = path.resolve(path.join(ROOT_DIR, req.url))
    console.log('filePath' + req.filePath)
    if(req.filePath.indexOf(ROOT_DIR) != 0) {
       res.send(400, 'Invalid path')
       return
    }

    fs.stat(req.filePath,
        function(err, stats) {
           console.log('stats' + stats)
           req.stat = stats
           next()
        }
    )

}

function sendHeaders(req, res, next) {

   console.log('send header url ' + req.url)
   let filePath = req.filePath //path.resolve(path.join(ROOT_DIR, req.url))
   console.log(req.stat)

   if(req.stat.isDirectory()) {
      console.log('is directory')
      fs.promise.readdir(filePath, function(err, data) {
         res.body = JSON.stringify(data)
         console.log('directory res body size ' + res.body.length)
         res.setHeader('Content-Length', res.body.length)
         res.setHeader('Content-Type', 'application/json')
         res.json(data)
         next()
         return
      })
   } else {
      console.log('is file and size: ' + req.stat["size"])
      let contentType = mime.contentType(path.extname(filePath))
      console.log('type: ' + contentType)
      res.setHeader('Content-Length',req.stat["size"])
      res.setHeader('Content-Type',contentType)
      fs.createReadStream(req.filePath).pipe(res)
      return
   }

}

function fileDelete(req, res, next) {
    console.log('in file delete, req stat ' + req.stat)
    if(!req.stat) return res.send(400, 'Invalid Path')
    if(req.stat.isDirectory()) {
       rimraf.promise(req.filePath)
       if (CLIENT_SOCKET) {
          console.log('inside delete dir with client socket enabled')
          CLIENT_SOCKET.write({
          	 "action": "delete",
          	 "path": req.url,
          	 "type": "dir",
          	 "contents": null,
          	 "updated": null
          })
       } else {
          console.log('inside delete dir with client socket not enabled')
       }


    } else {
       fs.promise.unlink(req.filePath)
    }
    next()
}

function setDirDetails(req, res, next) {
    console.log('in set dir details')
    let filePath = req.filePath
    let endsWithSlash = filePath.charAt(filePath.length-1) === path.seq
    let hasExt = path.extname(filePath) !== ''

    req.isDir = endsWithSlash || !hasExt
    req.dirPath = req.isDir ? filePath : path.dirname(filePath)
    console.log('req dirPath ' + req.dirPath)
    next()
}

function newConnectionHandler(socket) {
   console.log('received the connection from client')
	CLIENT_SOCKET = socket

  // Whenever a connection sends us an object...
  socket.on('data', function(data) {
    // Output the question property of the client's message to the console
    console.log("Client's question: " + data.question)
    console.log("__dirname is set to: " + path.join(__dirname))
	/*ls(ROOT_DIR, socket).then(() =>
		console.log("Sent requested files to caller....")
	).catch(e => console.log(e.stack))*/
  })
}
