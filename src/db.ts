import { MongoClient, Collection, Db } from "mongodb";
import config from "./config";

interface DatabaseConnection {
  conn: MongoClient;
  coll: Collection;
}

export const db = async (collection: string): Promise<DatabaseConnection | false> => {
  if(!config.mongodb_url)
    return false;
  
  const instanceId = process.env.INSTANCE_ID || 'default';
  
  const conn = await MongoClient.connect(config.mongodb_url, {
    ignoreUndefined: true,
  });
  return {
    conn,
    coll: conn.db(`wa-tlgrm`).collection(collection),
  };
};

const database = require("../db");

async function insert(collection: string, id: any, args: any): Promise<boolean> {
  try {
    var { conn, coll } = await database(collection);
    const query = id;
    const update = { $set: args};
    const options = { upsert: true };
    await coll.updateOne(query, update, options);
    return true;
  } catch (error) {
    console.log(error)
    return false;
  } finally {
    if (conn) {
      await conn.close();
    }
  }
}

async function read(collection: string, id: any): Promise<any> {
  try {
    var { conn, coll } = await database(collection);
    var data = await coll.findOne(id);
    return data;
  } catch (error) {
    return false;
  } finally {
    if (conn) {
      await conn.close();
    }
  }
}

async function deleteMany(collection: string, query: any): Promise<number> {
  try {
    var { conn, coll } = await database(collection);
    const result = await coll.deleteMany(query);
    console.log(`Deleted ${result.deletedCount} document(s)`);
    return result.deletedCount;
  } catch (error) {
    console.error('Error in deleteMany:', error);
    return 0;
  } finally {
    if (conn) {
      await conn.close();
    }
  }
}

async function del(collection: string, id: any): Promise<boolean> {
  try {
    var { conn, coll } = await database(collection);
    await coll.deleteOne(id);
    return true;
  } catch (error) {
    return false;
  } finally {
    if (conn) {
      await conn.close();
    }
  }
}

async function drop(collection: string): Promise<boolean> {
  try {
    var { conn, coll } = await database(collection);
    await coll.drop();
    return true;
  } catch (error) {
    console.error('Error deleting collection:', error);
    return false;
  } finally {
    if (conn) {
      await conn.close();
    }
  }
}

async function add(collection: string, id: any, addition: any): Promise<boolean> {
  try {
    var { conn, coll } = await database(collection);
    const query = id;
    const update = { $push: addition};
    const options = { upsert: true };
    await coll.updateOne(query, update, options);
    return true;
  } catch (error) {
    console.log(error)
    return false;
  } finally {
    if (conn) {
      await conn.close();
    }
  }
}

async function increment(collection: string, id: any, addition: any): Promise<boolean> {
  try {
    var { conn, coll } = await database(collection);
    const query = id;
    const update = {$inc: addition };
    const options = { upsert: true };
    await coll.updateOne(query, update, options);
    return true;
  } catch (error) {
    console.log(error)
    return false;
  } finally {
    if (conn) {
      await conn.close();
    }
  }
}

async function getAllGroupIDs(collection: string): Promise<string[]> {
  try {
    var { conn, coll } = await database(collection);
    const targetDocuments = await coll.find({ status: 'TargetGroup' }).toArray();
    const groupIDs = targetDocuments.map((doc: any) => doc.group_id);
    return groupIDs;
  } catch (error) {
    console.error('Error:', error);
    throw new Error('Failed to retrieve group IDs');
  } finally {
    if (conn) {
      await conn.close();
    }
  }
}

async function remove(collection: string, id: any, removal: any): Promise<boolean> {
  try {
    var { conn, coll } = await database(collection);
    const query = id;
    const update = { $pull: removal};
    const options = { upsert: true };
    await coll.updateOne(query, update, options);
    return true;
  } catch (error) {
    console.log(error)
    return false;
  } finally {
    if (conn) {
      await conn.close();
    }
  }
}

async function removeFields(collection: string, query: any, fieldsToRemove: string | string[]): Promise<boolean> {
  try {
    var { conn, coll } = await database(collection);
    
    // Fetch the document based on the provided query
    const document = await coll.findOne(query);
    
    if (!document) {
      console.log("Document not found");
      return false;
    }

    let update: { $unset: { [key: string]: number } } = { $unset: {} };

    // If fieldsToRemove is an array, remove all the fields mentioned in the array.
    if (Array.isArray(fieldsToRemove)) {
      fieldsToRemove.forEach((field: string) => {
        update.$unset[field] = 1;
      });
    } else {
      // If fieldsToRemove is a single field, remove only that field.
      update.$unset[fieldsToRemove] = 1;
    }

    const options = { upsert: true };
    await coll.updateOne(query, update, options);
    return true;
  } catch (error) {
    console.log(error);
    return false;
  } finally {
    if (conn) {
      await conn.close();
    }
  }
}

async function countDocuments(collection: string): Promise<number> {
  try {
    var { conn, coll } = await database(collection);
    const count = await coll.countDocuments();
    return count;
  } catch (error) {
    console.error('Error:', error);
    throw new Error('Failed to count documents');
  } finally {
    if (conn) {
      await conn.close();
    }
  }
}

async function addToDocument(collection: string, query: any, dataToAdd: any): Promise<boolean> {
  try {
    var { conn, coll } = await database(collection);

    // Check if the document exists
    const existingDocument = await coll.findOne(query);

    // If the document exists, update it with the new data
    if (existingDocument) {
      const update = { $set: dataToAdd };
      await coll.updateOne(query, update);
    } else {
      // If the document doesn't exist, insert a new one with the data
      await coll.insertOne({ ...query, ...dataToAdd });
    }

    return true;
  } catch (error) {
    console.log(error);
    return false;
  } finally {
    if (conn) {
      await conn.close();
    }
  }
}

async function update(collection: string, query: any, updateData: any): Promise<boolean> {
  try {
    var { conn, coll } = await database(collection);
    await coll.updateOne(query, { $set: updateData });
    return true;
  } catch (error) {
    console.log(error);
    return false;
  } finally {
    if (conn) {
      await conn.close();
    }
  }
}

async function readMany(collection: string, query: any): Promise<any[]> {
  try {
    var { conn, coll } = await database(collection);
    var data = await coll.find(query).toArray();
    return data;
  } catch (error) {
    console.error("Error in readMany:", error);
    return [];
  } finally {
    if (conn) {
      await conn.close();
    }
  }
}

// Simplified Listening Configuration Interface
export interface ListeningConfig {
  id: string;
  whatsappGroupId: string;
  telegramSources: string[];
  isEnabled: boolean;
  createdAt: Date;
  lastModified: Date;
}

async function saveListeningConfig(config: Omit<ListeningConfig, 'id' | 'createdAt' | 'lastModified'>): Promise<ListeningConfig | false> {
  let conn: any = null;
  try {
    const dbResult = await db('listening_configs');
    if (!dbResult) return false;
    
    conn = dbResult.conn;
    const coll = dbResult.coll;
    
    const configWithMeta: ListeningConfig = {
      ...config,
      id: `config_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date(),
      lastModified: new Date()
    };

    await coll.insertOne(configWithMeta);
    return configWithMeta;
  } catch (error) {
    console.error('Error saving listening config:', error);
    return false;
  } finally {
    if (conn) {
      await conn.close();
    }
  }
}

async function updateListeningConfig(id: string, updates: Partial<Omit<ListeningConfig, 'id' | 'createdAt'>>): Promise<boolean> {
  let conn: any = null;
  try {
    const dbResult = await db('listening_configs');
    if (!dbResult) return false;
    
    conn = dbResult.conn;
    const coll = dbResult.coll;

    const updateData = {
      ...updates,
      lastModified: new Date()
    };

    const result = await coll.updateOne({ id }, { $set: updateData });
    return result.modifiedCount > 0;
  } catch (error) {
    console.error('Error updating listening config:', error);
    return false;
  } finally {
    if (conn) {
      await conn.close();
    }
  }
}

async function getListeningConfig(id: string): Promise<ListeningConfig | null> {
  let conn: any = null;
  try {
    const dbResult = await db('listening_configs');
    if (!dbResult) return null;
    
    conn = dbResult.conn;
    const coll = dbResult.coll;

    const config = await coll.findOne({ id });
    return config as unknown as ListeningConfig | null;
  } catch (error) {
    console.error('Error getting listening config:', error);
    return null;
  } finally {
    if (conn) {
      await conn.close();
    }
  }
}

async function getAllListeningConfigs(): Promise<ListeningConfig[]> {
  let conn: any = null;
  try {
    const dbResult = await db('listening_configs');
    if (!dbResult) return [];
    
    conn = dbResult.conn;
    const coll = dbResult.coll;

    const configs = await coll.find({}).toArray();
    return configs as unknown as ListeningConfig[];
  } catch (error) {
    console.error('Error getting all listening configs:', error);
    return [];
  } finally {
    if (conn) {
      await conn.close();
    }
  }
}

async function getActiveListeningConfigs(): Promise<ListeningConfig[]> {
  let conn: any = null;
  try {
    const dbResult = await db('listening_configs');
    if (!dbResult) return [];
    
    conn = dbResult.conn;
    const coll = dbResult.coll;

    const configs = await coll.find({ isEnabled: true }).toArray();
    return configs as unknown as ListeningConfig[];
  } catch (error) {
    console.error('Error getting active listening configs:', error);
    return [];
  } finally {
    if (conn) {
      await conn.close();
    }
  }
}

async function deleteListeningConfig(id: string): Promise<boolean> {
  let conn: any = null;
  try {
    const dbResult = await db('listening_configs');
    if (!dbResult) return false;
    
    conn = dbResult.conn;
    const coll = dbResult.coll;

    const result = await coll.deleteOne({ id });
    return result.deletedCount > 0;
  } catch (error) {
    console.error('Error deleting listening config:', error);
    return false;
  } finally {
    if (conn) {
      await conn.close();
    }
  }
}

export {
  insert,
  read,
  del,
  add,
  remove,
  drop,
  increment,
  getAllGroupIDs,
  removeFields,
  addToDocument,
  countDocuments,
  update,
  deleteMany,
  readMany,
  saveListeningConfig,
  updateListeningConfig,
  getListeningConfig,
  getAllListeningConfigs,
  getActiveListeningConfigs,
  deleteListeningConfig
};