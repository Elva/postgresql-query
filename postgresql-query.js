'use strict';


//
// Node.js modules sand 3rd party libs.
//
var lib = {
    pg: require('pg')
};


//
// Public API
//
module.exports = {
    config: config,
    query: query,
    queryOne: queryOne,
    queryInsert: queryInsert,
    queryUpdate: queryUpdate,
    beginTransaction: pgTransaction
};


//
// Internal reference for a connection string.
//
var PG_CONN_STRING = null;


//
// Prepare module for querying. 
//
function config(options) {
    options = options || {};
    options.username = options.username || 'postgres';
    options.password = options.password || '';
    options.host = options.host || '127.0.0.1';
    options.port = options.port || 5432;
    options.database = options.database || 'postgres';

    if (options.connString) {
        PG_CONN_STRING = options.connString;
    } else {
        PG_CONN_STRING = 'postgres://' + options.username + ':' + options.password + '@' + 
        options.host + ':' + options.port + '/' + options.database;
    }
}


//
// Query a database with parameters and get results in a callback function.
// Or run multiple queries in specified order and get all results in a finalCallback functions.
//
// query(sql, values, callback)
//
//    query('SELECT * FROM albums WHERE artist_id = $1', 47, function (err, albums) {
//    
//    });
//
// query(tasks, finalCallback)
//
//    query([
//        ['SELECT * FROM albums WHERE artist_id = $1', 47],
//        ['SELECT * FROM genres WHERE artist_id = $1 AND mood = $2', [47, 'sad']],
//        ['SELECT * FROM comments WHERE artist_id = $1', [47]]
//    ], function (err, albums, genres, comments) {
//        
//    });
//
// Note: Connection pool isn't used because it "sucks":
// https://github.com/brianc/node-postgres/issues/227
//
function query() {
    var args             = Array.prototype.slice.call(arguments);
    var tasks            = args[0];
    var isMultiQueryMode = Array.isArray(tasks);
    var callback         = args[args.length - 1];
    var hasCallback      = (typeof callback === 'function');
    var sqlQuery;
    var sqlValues;

    var client = new lib.pg.Client(PG_CONN_STRING);
    client.connect();

    if (isMultiQueryMode) {
        queryTasks(client, tasks, function () {
            if (hasCallback) {
                callback.apply(null, arguments);
            }
            client.end();
        });
    } else {
        sqlQuery = tasks;
        sqlValues = hasCallback ? args.slice(1, args.length - 1) : args.slice(1);

        client.query(sqlQuery, flatArray(sqlValues), function (err, result) {
            var rows = (result && Array.isArray(result.rows)) ? result.rows : [];
            
            if (hasCallback) {
                callback(err, rows);
            }

            client.end();
        });
    }
}


//
// Query a database and use only the first row.
//
function queryOne(sql, values, callback) {
    query(sql, values, function (err, rows) {
        if (typeof callback === 'function') {
            callback(err, rows[0]);
        }
    });
}


//
// Run INSERT query built by buildInsertQuery() 
// and get result in a callback function.
//
function queryInsert(data, callback) {
    var q = buildInsertQuery(data);
    queryOne(q.sql, q.values, callback);
}


//
// Run UPDATE query built by buildUpdateQuery() 
// and get result in a callback function.
//
function queryUpdate(data, callback) {
    var q = buildUpdateQuery(data);
    queryOne(q.sql, q.values, callback);
}


//
// Query builder for INSERT statement.
//
//    buildInsertQuery({
//        table: 'user',
//        fields: {
//            first_name: 'John',
//            last_name: 'Doe',
//            email: 'example@example.com'
//        },
//        returnValue: 'user_id'
//    });
//    
//    Returns:
//    {
//        sql: 'INSERT INTO user ( first_name, last_name, email ) VALUES ( $1, $2, $3 ) RETURNING user_id',
//        values: ['John', 'Doe', 'example@example.com']
//    }
//
function buildInsertQuery(data) {
    var sql = 'INSERT INTO ' + data.table + ' ( ';
    var fields = Object.keys(data.fields);
    var pIndex = 0;
    var values = [];

    fields.forEach(function (field, i) {
        var isLastField = (fields.length === i + 1);
        sql += field + (isLastField ? ' ' : ', ');
    });

    sql += ') VALUES ( ';

    fields.forEach(function (field, i) {
        var isLastField = (fields.length === i + 1);
        var val = data.fields[field];

        if (field === 'sort_order' && val === 'auto') {
            sql += '(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM ' + data.table + ')';
        } else {
            sql += '$' + (pIndex += 1);
            values.push(val);
        }

        sql += isLastField ? ' ' : ', ';
    });

    sql += ')';

    if (data.returnValue) {
        sql += ' RETURNING ' + data.returnValue;
    }

    return { sql : sql, values: values };
}


//
// Query builder for UPDATE statement.
//
//    buildUpdateQuery({
//        table: 'user',
//        fields: {
//            first_name: 'John',
//            last_name: 'Doe',
//            email: 'example@example.com'
//        },
//        where: {
//            userId: 47
//        }
//    });
//
//    Returns:
//    {
//       sql: 'UPDATE user SET first_name = $1, last_name = $2, email = $3  WHERE id = $4',
//       values: ['John', 'Doe', 'example@example.com', 47]
//    }
//
function buildUpdateQuery(data) {
    var sql = 'UPDATE ' + data.table + ' SET ';
    var fields = Object.keys(data.fields);
    var where  = Object.keys(data.where);
    var values = [];

    fields.forEach(function (field, i) {
        var pIndex = i + 1;
        var isLastField = (fields.length === pIndex);
        var val = data.fields[field];

        if (isObject(val) && Object.keys(val).length) { 
            // Concatanate JSON data instead of replacing it.
            sql += field + ' = ' + field + ' || $' + pIndex; 
        } else {
            sql += field + ' = $' + pIndex;
        }

        sql += isLastField ? ' ' : ', ';
        values.push(val);
    });

    sql += ' WHERE ';

    where.forEach(function (field, i) {
        var pIndex = fields.length + i + 1;
        var isLastField = (where.length === i + 1);

        sql += field + ' = $' + pIndex + (isLastField ? ' ' : ' AND ');
        values.push(data.where[field]);
    });

    if (data.returnValue) {
        sql += ' RETURNING ' + data.returnValue;
    }

    return { sql: sql, values: values };
}


//
// Run multiple SQL queries in specified order and 
// get all results in a finalCallback function.
//
// Note: In order for this function to be usable during transactions 
// client.end() isn't automatically called when finalCallback function is present.
//
function queryTasks(client, tasks, finalCallback) {
    var hasFinalCallback = isFunction(finalCallback);
    var count = tasks.length;
    var results = [];

    function runQuery(index) {
        if (index >= count) {
            if (hasFinalCallback) {
                finalCallback.apply(null, [null].concat(results));
            } else {
                client.end();
            }
        } else {
            var task = tasks[index];
            var sqlQuery, sqlParams;

            if (isObject(task)) {
                var q = task.where ? buildUpdateQuery(task) : buildInsertQuery(task);
                sqlQuery  = q.sql;
                sqlParams = q.values;
            } else {
                sqlQuery  = task[0];
                sqlParams = flatArray(task.slice(1));
            }

            function internalCallback(err, result) {
                var rows = (result && Array.isArray(result.rows)) ? result.rows : [];

                // Insert/Update statments doesn't 
                // return more than one row right?
                if (isObject(task) && rows.length === 1) {
                    rows = rows[0];
                }
                
                if (err) {
                    if (hasFinalCallback) {
                        results.push(rows);
                        finalCallback.apply(null, [err].concat(results));
                    } else {
                        client.end();
                    }
                } else {
                    if (sqlQuery !== 'BEGIN') {
                        results.push(rows);
                    }
                    runQuery(index + 1);
                }
            }

            client.query(sqlQuery, sqlParams, internalCallback);
        }
    }

    runQuery(0);
}


//
// Better wrapper for transactions.
//
function pgTransaction(callback) {
    var started = false;
    var ended   = false;
    var client  = new lib.pg.Client(PG_CONN_STRING);

    function rollbackFromPool(client, done) {
        client.query('ROLLBACK', function (err) {
            ended = true;
            return done(err);
        });
    }

    if (isFunction(callback)) {
        lib.pg.connect(PG_CONN_STRING, function (err, client, done) {
            if (err) { return console.error(err); }

            client.query('BEGIN', function (err) {
                if (err) { return rollbackFromPool(client, done); }

                callback({
                    rollback: function () {
                        rollbackFromPool(client, done);
                    },
                    commit: function () {
                        ended = true;
                        client.query('COMMIT', done);
                    },
                    query: function (tasks, callback) {
                        tasks = Array.isArray(tasks) ? tasks : [tasks];

                        if (!ended) {
                            queryTasks(client, tasks, callback);
                        }
                    }
                });
            });
        });
    } else {
        client.connect();
        return {
            rollback: function () {
                ended = true;
                client.query('ROLLBACK', function () {
                    client.end();
                });
            },
            commit: function () {
                ended = true;
                client.query('COMMIT', client.end.bind(client));
            },
            query: function (tasks, callback) {
                tasks = Array.isArray(tasks) ? tasks : [tasks];

                if (!started) {
                    tasks.unshift(['BEGIN']);
                }

                if (!ended) {
                    queryTasks(client, tasks, callback);
                }
            }
        };
    }
}


//
// Convert any number of multi-diemensional array-like objects 
// into a single flat array.
//
// Example:
//   flatArray(1, 2, [3, 4, [5]], '6', ['7'], { num: 8 }, [9], 10);
//      => [1, 2, 3, 4, 5, '6', '7', { num: 8 }, 9, 10]
//
function flatArray() {
    var flat = [], i, arg, isArrayLike;

    for (i = 0; i < arguments.length; i += 1) {
        arg = arguments[i];
        isArrayLike = arg && typeof arg === 'object' && arg.length !== undefined;

        if (isArrayLike) {
            flat = flat.concat(flatArray.apply(null, arg));
        } else {
            flat.push(arg);
        }
    }

    return flat;
}


//
// Check if variable is a valid object.
//
function isObject(obj) {
    return Object.prototype.toString.call(obj) === '[object Object]';
}


//
// Check if variable is a valid function.
//
function isFunction(obj) {
    return typeof obj === 'function';
}