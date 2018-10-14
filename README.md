### `postgresql-query`
`Querying PostgreSQL with Node.js made easy.`

&nbsp;

*Created by: [Lasha Tavartkiladze](https://github.com/coloraggio) at [Elva](https://elva.org)*  
*License: MIT*

&nbsp;

## Install

    npm install postgresql-query



## config()

Require and prepare module for querying.

```js
let db = require('postgresql-query');

db.config({
    username: '',
    password: '',
    host: '',
    database: '' 
});
```



## query()

Query a database and get results in a callback function.  
```
db.query(sql, values, callback);
```
```js
db.query('SELECT * FROM albums WHERE artist_id = $1', 47, function (err, albums) {
    
});
```
Or run multiple queries in specified order and get all results in a finalCallback functions.
```
db.query(queries, finalCallback);
```
```js
db.query([
    ['SELECT * FROM albums WHERE artist_id = $1', 47],
    ['SELECT * FROM genres WHERE artist_id = $1 AND mood = $2', [47, 'sad']],
    ['SELECT * FROM comments WHERE artist_id = $1', [47]]
], function (err, albums, genres, comments) {
        
});
```
Or use async/await
```
db.query(sql, values);
```
```js
(async function () {
    try {
        let albums = await db.query('SELECT * FROM albums WHERE artist_id = $1', 47);
        let genres = await db.query('SELECT * FROM genres WHERE artist_id = $1 AND mood = $2', [47, 'sad']);
        let comments = await db.query('SELECT * FROM comments WHERE artist_id = $1', [47]);
    } catch (err) {
        console.log(err);
    }
})();
```



## queryOne()
Query a database and use only the first row.
```
db.queryOne(sql, values, callback);
```
```js
db.queryOne('SELECT * FROM artists WHERE id = $1', 47, function (err, artist) {
    // artist.name
});
```
```
db.queryOne(sql, values);
```
```js
(async function () {
    await artist = db.queryOne('SELECT * FROM artists WHERE id = $1', 47);
})().catch(function (err) {});
```



## insert()

Helper function to make it easy writing INSERT queries.
```
db.insert(obj, callback);
```
```js
db.insert({
    table: 'artists',
    fields: {
        first_name: 'John',
        last_name: 'Doe',
        country: 'Italy'
    },
    returnValue: '*'
}, function (err, insertedRow) {
    
});
```
Above is the same as this:
```js
db.query('INSERT INTO artists (first_name, last_name, country) VALUES ($1, $2, $3) RETURNING *', ['John', 'Doe', 'Italy'], function (err, insertedRows) {
    
});
```



## update()

Helper function to make it easy writing UPDATE queries.
```
db.update(obj, callback);
```
```js
db.update({
    table: 'artists',
    fields: {
        first_name: 'Mister',
        last_name: 'Smith',
        country: 'Spain'
    },
    where: {
        id: 38
    },
    returnValue: '*'
}, function (err, updatedRow) {
    
});
```
Above is the same as this:
```js
db.query('UPDATE artists SET first_name = $1, last_name = $2, country = $3 WHERE id = $4 RETURNING *', ['Mister', 'Smith', 'Spain', 38], function (err, updatedRows) {
    
});
```



## transaction()

Helper function to make it easy dealing with transactions. It takes only a single parameter - a callback function and passed transaction object to it.
```
db.transaction(function (transaction) {
});
```
Or async/await

```js
let transaction = await db.transaction();
```

Transaction object has three methods:

```js
transaction.query();
transaction.commit();
transaction.rollback();
```
transaction.query() is similar to db.query and can run multiple queries one after another. It also supports db.insert() and db.update() syntax, so handy way of writing INSERT/UPDATE queries can be used here as well.

Example below starts a transaction, inserts a new artist and if that query was successfull adds two albums on that artist and then commits the transaction.
```js
(async function () {
    let transaction;
    try {
        tranaction = await db.transaction();
        let artist = await transaction.query({
            table: 'artist',
            fields: {
                first_name: 'Something'
            },
            returnValue: '*'
        });
        await transaction.query([
            {
                table: 'albums',
                fields: {
                    artist_id: insertedArtist.id,
                    title: 'Best Songs',
                    release_year: 2017
                }
            }, {
                table: 'albums',
                fields: {
                    artist_id: insertedArtist.id,
                    title: 'New Century',
                    release_year: 2016
                }
            }
        ]);
        transaction.commit();
    } catch (err) {
        console.log(err);
        transaction.rollback();
    }
})();
```