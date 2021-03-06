var MongoClient = require('mongodb').MongoClient;
var ObjectID = require('mongodb').ObjectID;
var mongodbFixture = require('mongodb-fixture');
var jsonfile = require('jsonfile');
var YAML = require('yamljs');
var path = require('path');
var fs = require('fs');
var forEach = require('lodash.foreach');
var async = require('async');

function Connector(connectionString, initialMapping){
    var _mapping = {};

    if(initialMapping){
        forEach(initialMapping, function(id, key){
            _mapping[key] = ObjectID.createFromHexString(id);
        });
    }

    this.connectionString = connectionString;

    Object.defineProperty(this, 'idMap', {
        get: function(){
            return _mapping;
        }
    });
}

Connector.prototype = {
    open: function(cb){
        var self = this;

        MongoClient.connect(this.connectionString, function(err, db){
            if(err){return cb(err);}

            self.db = db;
            self.mfix = mongodbFixture(db);
            self.db.dropDatabase(function(err){
                if(err){return cb(err);}

                self.reset(cb);
            });
        });
    },

    reset: function(fixtures, cb){
        var self = this;

        if(!cb){
            cb = fixtures;
            fixtures = null;
        }

        fixtures = fixtures || this.fixtures;

        async.eachOf(fixtures, function(records, collection, cb){
            self.db.dropCollection(collection, function(err){
                if(err && err.message != 'ns not found'){
                    cb(err);
                } else {
                    cb();
                }
            });
        }, function(err){ 
            if(err){return cb(err);}

            self.mfix.fixture(fixtures, cb);
        });
    },

    close: function(cb){
        this.mfix.tearDown(cb);
    },

    parse: function(fixtures, cb){
        var result = {};
        var self = this;

        function parseFile(filename, cb){
            var finalFixtures;
            //load from a file
            if(path.extname(filename).toLowerCase() == '.json'){
                try {
                    finalFixtures = jsonfile.readFileSync(filename);
                } catch(ex){
                    return cb(ex);
                }
            } else if(path.extname(filename).toLowerCase() == '.yml'){
                try {
                    finalFixtures = YAML.load(filename);
                } catch(ex) {
                    return cb(ex);
                }
            } else {
                return cb(new Error('Invalid fixture file name: ' + filename));
            }

            cb(null, finalFixtures);
        }

        if(isString(fixtures)){
            var fixturePath = path.resolve(fixtures);
            fs.stat(fixturePath, function(err, stats){
                if(stats.isDirectory()){
                    fs.readdir(fixturePath, function(err, files){
                        var result = {};

                        async.each(files, function(filename, cb){
                            var ext = path.extname(filename);
                            var collection = path.basename(filename, ext);

                            parseFile(filename, function(err, fileFixtures){
                                if(err){return cb(err);}
                                result[collection] = fileFixtures;
                                cb();
                            });
                        }, function(err){
                            if(err){return cb(err);}

                            cb(null, self.import(result));
                        });
                    });
                } else {
                    parseFile(fixturePath, function(err, fileFixtures){
                        if(err){return cb(err);}

                        cb(null, self.import(fileFixtures));
                    });
                }
            });
        } else {
            return cb(null, this.import(fixtures));
        }
    },

    import: function(fixtures){
        var results = {};
        var self = this;
        fixtures = fixtures || {};

        forEach(fixtures, function(collection, collectionName){
            var outCollection = [];
            forEach(collection, function(record){
                var outRecord = {};
                forEach(record, function(fieldValue, fieldName){
                    if(isString(fieldValue)){
                        var idMatches = fieldValue.match(/^__(.*)__$/i);
                        var stringMatches = fieldValue.match(/^___(.*)___$/i);

                        if(stringMatches){
                            oid = getObjectId(self, stringMatches[1]);
                            outRecord[fieldName] = oid.toHexString();
                        } else if(idMatches) {
                            oid = getObjectId(self, idMatches[1]);
                            outRecord[fieldName] = oid;
                        } else {
                            outRecord[fieldName] = fieldValue;
                        }
                    } else {
                        outRecord[fieldName] = fieldValue;
                    }
                });
                outCollection.push(outRecord);
            });
            results[collectionName] = outCollection;
        });

        this.fixtures = results;
        return results;
    }    
}

function getObjectId(connector, value){
    var result = connector.idMap[value];

    if(!result){
        result = new ObjectID();
        connector.idMap[value] = result;
    }

    return result;
}

function isString(value){
    return Object.prototype.toString.call(value) == '[object String]';
}

exports.connect = function(connectionString, initialMapping, fixtures, cb){
    if(!cb){
        cb = fixtures;
        fixtures = initialMapping;
        initialMapping = null;
    }

    var connector = new Connector(connectionString, initialMapping);    

    connector.parse(fixtures, function(err){
        if(err){return cb(err);}

        connector.open(function(err){
            if(err){return cb(err);}

            cb(null, connector);
        });
    });
};