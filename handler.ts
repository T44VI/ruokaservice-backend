import { APIGatewayProxyHandler, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDB } from "aws-sdk";
import { v4 as uuid } from "uuid";
import _ from "lodash";
import "source-map-support/register";

const dynamoDB = new DynamoDB.DocumentClient();

type User = {
  id: string;
  name: string;
  archievedBalance: number;
};

type IndUser = User & {
  allergyProfiles: AllergyProfile[];
};

type RespIndUser = User & {
  profiles: { [key: string]: AllergyProfile };
};

type WithUserId<T> = {
  userId: string;
  data: T;
};

type AllergyProfile = {
  id: string;
  name?: string;
  allergies: string[];
};

type Price = {
  id: string;
  fod: "lunch" | "coffee" | "dinner";
  start: string;
  end: string;
  normal: number;
  young: number;
  child: number;
  special: boolean;
  time: string;
  name: string;
};

type DBPrice = Price & {
  year: number;
};

type DBPayment = {
  date: string;
  amount: number;
  id: string; //ind: uuid, month: userId-year-month, year: userId-year
  "user-query-key": string; //ind, month: userId-year, year: userId
  userId: string;
  year: number;
  type: "year" | "month" | "ind";
  name: string;
};

interface Payment {
  id: string;
  amount: number;
  name: string;
  type: "ind" | "month" | "year";
  date: DateDay;
}

interface DateDay {
  year: number;
  month: number;
  day: number;
}

interface AllPayments {
  ts: number;
  payments: Payment[];
}

interface KitchenDay {
  month: number;
  year: number;
  day: number;
  ts: number;
  lunch: UserFood[];
  coffee: UserFood[];
  dinner: UserFood[];
}

export type UserFood = Food & {
  userId: string;
};

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Credentials": true,
};

type DBDay = {
  "userId-year-month-day": string;
  "userId-year-month": string;
  "year-month": string;
  year: number;
  month: number;
  day: number;
  userId: string;
  lunch?: Food;
  coffee?: Food;
  dinner?: Food;
  totals: {
    lunch?: number;
    coffee?: number;
    dinner?: number;
  };
};

type TMonth = {
  year: number;
  month: number;
  ts: number;
  days: Day[];
  allDays: { num: number; count: number }[];
};

type RealTMonth = {
  year: number;
  month: number;
  ts: number;
  days: Day[];
};

type Day = {
  num: number;
  lunch?: Food;
  coffee?: Food;
  dinner?: Food;
};

type Food = {
  normal?: number;
  young?: number;
  child?: number;
  specialIds?: SpecialFoodWithId[];
  special?: SpecialFood[];
};

type SpecialFoodWithId = {
  specialId: string;
  base: "normal" | "young" | "child";
  count: number;
  allergies: string[];
  name: string;
};

type SpecialFood = {
  base: "normal" | "young" | "child";
  count: number;
  allergies: string[];
};

const monthNames = [
  "Tammikuu",
  "Helmikuu",
  "Maaliskuu",
  "Huhtikuu",
  "Toukokuu",
  "Kesäkuu",
  "Heinäkuu",
  "Elokuu",
  "Syyskuu",
  "Lokakuu",
  "Marraskuu",
  "Joulukuu",
];

const getMonthYearPairs = (
  start: string,
  end: string
): { year: number; month: number }[] => {
  const sps = start.split("-").map((s: string): number => Number(s));
  const spe = end.split("-").map((s: string): number => Number(s));
  const res: { year: number; month: number }[] = [];
  const diff = (spe[0] - sps[0]) * 12 + (spe[1] - sps[1]);
  for (let i = -1; i < diff; i++) {
    res.push({
      year: sps[0] + Math.floor((i + sps[1]) / 12),
      month: (sps[1] + i) % 12,
    });
  }
  return res;
};

const genRes = (
  code: number,
  res: any,
  role?: string
): APIGatewayProxyResult => {
  return {
    statusCode: code,
    headers,
    body: JSON.stringify(
      {
        ts: Date.now(),
        role: role || "",
        data: res,
      },
      null,
      2
    ),
  };
};

const success = (res: any, event: any): APIGatewayProxyResult => {
  console.log(event);
  return genRes(200, res, event.requestContext.authorizer.role);
};

const fail = (message: string): APIGatewayProxyResult =>
  genRes(500, { message });

const user = {
  _private: {
    table: process.env.USER_TABLE,
  },
  add(user: RespIndUser) {
    const params = {
      TableName: this._private.table,
      Item: user,
    };
    return dynamoDB.put(params).promise();
  },
  addAllergy(id: string, profile: AllergyProfile) {
    const params = {
      TableName: this._private.table,
      Key: {
        id,
      },
      UpdateExpression: "set profiles.#profileId = :profile",
      ExpressionAttributeNames: {
        "#profileId": profile.id,
      },
      ExpressionAttributeValues: {
        ":profile": profile,
      },
    };
    return dynamoDB.update(params).promise();
  },
  checkProfile(profile: AllergyProfile) {
    return profile.id.length === 0
      ? {
          ...profile,
          id: uuid(),
        }
      : profile;
  },
  createNew(
    name: string,
    archievedBalance: number = 0,
    allergyProfileArr: AllergyProfile[] = []
  ): RespIndUser {
    //TODO: validate
    const profiles = {};
    allergyProfileArr.forEach((prof) => {
      if (prof.id) {
        profiles[prof.id] = prof;
      } else {
        const id = uuid();
        profiles[id] = { ...prof, id };
      }
    });
    return {
      id: uuid(),
      name,
      archievedBalance,
      profiles,
    };
  },
  async getAll(): Promise<User[]> {
    const params = {
      TableName: this._private.table,
      ProjectionExpresson: "id, name, archievedBalance",
    };
    try {
      const res = await dynamoDB.scan(params).promise();
      return res.Items.map((a) => {
        const { id, name, archievedBalance } = a;
        return { id, name, archievedBalance };
      });
    } catch (e) {
      console.log(e);
      return [];
    }
  },
  getById(id: string): Promise<RespIndUser> {
    const params = {
      TableName: this._private.table,
      Key: {
        id,
      },
    };
    return dynamoDB
      .get(params)
      .promise()
      .then((res) => {
        const { id, name, archievedBalance, profiles } = res.Item;
        return { id, name, archievedBalance, profiles };
      });
  },
  getByName(name: string): Promise<IndUser> {
    const params = {
      TableName: this._private.table,
      Key: {
        name,
      },
    };
    return dynamoDB
      .get(params)
      .promise()
      .then((res) => {
        const { id, name, archievedBalance, allergyProfiles } = res.Item;
        return { id, name, archievedBalance, allergyProfiles };
      });
  },
  updateArchievedBalance(id: string, newArchievedBalance: number) {
    const params = {
      TableName: this._private.table,
      Key: {
        id,
      },
      AttributeUpdates: {
        archievedBalance: {
          Value: newArchievedBalance,
        },
      },
    };
    return dynamoDB.update(params).promise();
  },
};

const price = {
  _private: {
    table: process.env.PRICE_TABLE,
  },
  dbPriceFromPrice(price: Price): DBPrice {
    return {
      ...price,
      year: Number(price.start.split("-")[0]),
    };
  },
  add(price: DBPrice) {
    const params = {
      TableName: this._private.table,
      Item: price,
    };
    return dynamoDB.put(params).promise();
  },
  createNew(
    fod: "lunch" | "coffee" | "dinner",
    start: string,
    end: string,
    normal: number,
    young: number,
    child: number,
    special: boolean,
    time: string,
    name?: string
  ): Price {
    //TODO: validate!!
    return {
      id: uuid(),
      fod,
      start,
      end,
      normal,
      young,
      child,
      special,
      time,
      name,
    };
  },
  async getByYear(year: number): Promise<Price[]> {
    const params = {
      TableName: this._private.table,
      IndexName: "YearIndex",
      KeyConditionExpression: "#y = :year",
      ExpressionAttributeValues: {
        ":year": year,
      },
      ExpressionAttributeNames: {
        "#y": "year",
      },
    };
    try {
      const res = await dynamoDB.query(params).promise();
      return res.Items.map((a) => {
        const {
          id,
          fod,
          start,
          end,
          normal,
          young,
          child,
          special,
          time,
          name,
        } = a;
        return {
          id,
          fod,
          start,
          end,
          normal,
          young,
          child,
          special,
          time,
          name,
        };
      });
    } catch (e) {
      console.log(e);
      return [];
    }
  },
};

const regs = {
  _private: {
    table: process.env.REGS_TABLE,
  },
  save(day: DBDay) {
    const params = {
      TableName: this._private.table,
      Item: day,
    };
    return dynamoDB.put(params).promise();
  },
  createFromDay(day: Day, userId: string, year: number, month: number): DBDay {
    const countFromFood = (food: Food): number =>
      (food.normal ? food.normal : 0) +
      (food.young ? food.young : 0) +
      (food.child ? food.child : 0) +
      (food.special && food.special.length > 0
        ? food.special.reduce((acc, sp) => acc + sp.count, 0)
        : 0) +
      (food.specialIds && food.specialIds.length > 0
        ? food.specialIds.reduce((acc, sp) => acc + sp.count, 0)
        : 0);
    return {
      "userId-year-month-day": `${userId}-${year}-${month}-${day.num}`,
      "userId-year-month": `${userId}-${year}-${month}`,
      "year-month": `${year}-${month}`,
      lunch: day.lunch,
      coffee: day.coffee,
      dinner: day.dinner,
      userId,
      year,
      month,
      day: day.num,
      totals: {
        lunch: day.lunch ? countFromFood(day.lunch) : 0,
        coffee: day.coffee ? countFromFood(day.coffee) : 0,
        dinner: day.dinner ? countFromFood(day.dinner) : 0,
      },
    };
  },
  async getByYearAndMonth(year: number, month: number): Promise<DBDay[]> {
    const params = {
      TableName: this._private.table,
      IndexName: "MonthIndex",
      KeyConditionExpression: "#y = :month",
      ExpressionAttributeValues: {
        ":month": `${year}-${month}`,
      },
      ExpressionAttributeNames: {
        "#y": "year-month",
      },
    };
    try {
      const res = await dynamoDB.query(params).promise();
      return res.Items.map((item: DBDay): DBDay => ({ ...item }));
    } catch (e) {
      console.log(e);
      return [];
    }
  },
  async getByUserIdAndYearAndMonth(
    userId: string,
    year: number,
    month: number
  ): Promise<TMonth> {
    const params = {
      TableName: this._private.table,
      IndexName: "UserMonthIndex",
      KeyConditionExpression: "#u = :userMonth",
      ExpressionAttributeValues: {
        ":userMonth": `${userId}-${year}-${month}`,
      },
      ExpressionAttributeNames: {
        "#u": "userId-year-month",
      },
    };
    const totalsParams = {
      TableName: this._private.table,
      IndexName: "MonthIndex",
      KeyConditionExpression: "#m = :month",
      ExpressionAttributeValues: {
        ":month": `${year}-${month}`,
      },
      ExpressionAttributeNames: {
        "#m": "year-month",
      },
      ProjectionExpresson: "day, totals",
    };
    try {
      const [res, totals] = await Promise.all([
        dynamoDB.query(params).promise(),
        dynamoDB.query(totalsParams).promise(),
      ]);
      return {
        ts: Date.now(),
        year,
        month,
        days: res.Items.map((a) => {
          const { day, lunch, coffee, dinner } = a;
          return {
            num: day,
            lunch,
            coffee,
            dinner,
          };
        }),
        allDays: totals.Items.map((a) => {
          const { day, totals } = a;
          const count = Math.max(
            totals.lunch || 0,
            totals.coffee || 0,
            totals.dinner || 0
          );
          return {
            num: day,
            count,
          };
        }),
      };
    } catch (e) {
      console.log(e);
      return { ts: Date.now(), year, month, days: [], allDays: [] };
    }
  },
  async getAllByDay(
    year: number,
    month: number,
    day: number
  ): Promise<KitchenDay> {
    const params = {
      TableName: this._private.table,
      IndexName: "MonthIndex",
      KeyConditionExpression: "#m = :month AND #d = :day",
      ExpressionAttributeValues: {
        ":month": `${year}-${month}`,
        ":day": day,
      },
      ExpressionAttributeNames: {
        "#m": "year-month",
        "#d": "day",
      },
    };
    try {
      const res = await dynamoDB.query(params).promise();
      const lunch: UserFood[] = [];
      const coffee: UserFood[] = [];
      const dinner: UserFood[] = [];
      res.Items.forEach((reg: DBDay) => {
        if (reg.lunch) {
          lunch.push({
            ...reg.lunch,
            userId: reg.userId,
          });
        }
        if (reg.coffee) {
          coffee.push({
            ...reg.coffee,
            userId: reg.userId,
          });
        }
        if (reg.dinner) {
          dinner.push({
            ...reg.dinner,
            userId: reg.userId,
          });
        }
      });

      return {
        ts: Date.now(),
        year,
        month,
        day,
        lunch,
        coffee,
        dinner,
      };
    } catch (e) {
      console.log(e);
      return {
        ts: Date.now(),
        year,
        month,
        day,
        lunch: [],
        coffee: [],
        dinner: [],
      };
    }
  },
};

const payments = {
  _private: {
    table: process.env.PAYMENTS_TABLE,
  },
  save(payment: DBPayment) {
    const params = {
      TableName: this._private.table,
      Item: payment,
    };
    return dynamoDB.put(params).promise();
  },
  create: {
    ind(
      dateDay: DateDay,
      userId: string,
      amount: number,
      name: string,
      id?: string
    ): DBPayment {
      return {
        id: id || uuid(),
        date: `${dateDay.year}-${
          dateDay.month + 1 < 10 ? `0${dateDay.month + 1}` : dateDay.month + 1
        }-${dateDay.day < 10 ? `0${dateDay.day}` : dateDay.day}`,
        userId,
        amount,
        type: "ind",
        year: dateDay.year,
        name,
        "user-query-key": `${userId}-${dateDay.year}`,
      };
    },
    month(
      month: number,
      year: number,
      userId: string,
      amount: number,
      name: string
    ): DBPayment {
      const realDate = new Date(year, month + 1, 0);
      return {
        id: `${userId}-${year}-${month < 10 ? `0${month}` : month}`,
        date: `${year}-${month < 10 ? `0${month}` : month}-${
          realDate.getDate() < 10
            ? `0${realDate.getDate()}`
            : realDate.getDate()
        }`,
        userId,
        amount,
        type: "month",
        year,
        name,
        "user-query-key": `${userId}-${year}`,
      };
    },
    year(
      year: number,
      userId: string,
      amount: number,
      name: string
    ): DBPayment {
      return {
        id: `${userId}-${year}`,
        date: `${year}-12-31`,
        userId,
        amount,
        type: "year",
        year,
        name,
        "user-query-key": userId,
      };
    },
  },
  asPayment(dbp: DBPayment): Payment {
    const dateSplitted = dbp.date.split("-").map((s) => Number(s));
    return {
      id: dbp.id,
      date: {
        year: dateSplitted[0],
        month: dateSplitted[1],
        day: dateSplitted[2],
      },
      amount: dbp.amount,
      type: dbp.type,
      name: dbp.name,
    };
  },
  async getPaymentsOfYear(userId: string, year: number): Promise<AllPayments> {
    const params = {
      TableName: this._private.table,
      IndexName: "UserQueryIndex",
      KeyConditionExpression: "#u = :userYear",
      ExpressionAttributeValues: {
        ":userYear": `${userId}-${year}`,
      },
      ExpressionAttributeNames: {
        "#u": "user-query-key",
      },
    };
    const yearParams = {
      TableName: this._private.table,
      IndexName: "UserQueryIndex",
      KeyConditionExpression: "#u = :user",
      ExpressionAttributeValues: {
        ":user": userId,
      },
      ExpressionAttributeNames: {
        "#u": "user-query-key",
      },
    };
    try {
      const [res, yearRes] = await Promise.all([
        dynamoDB.query(params).promise(),
        dynamoDB.query(yearParams).promise(),
      ]);
      const resItems = (res.Items || []).concat(yearRes.Items || []);
      return {
        ts: Date.now(),
        payments: resItems
          .map((dbp: DBPayment) => payments.asPayment(dbp))
          .filter((val) => val.id !== `${userId}-${year}`),
      };
    } catch (e) {
      console.log(e);
      return { ts: Date.now(), payments: [] };
    }
  },
};

const paymentUpdates = {
  async updateYearByUserId(userId: string, year: number): Promise<any> {
    const baseVals = await payments.getPaymentsOfYear(userId, year);
    return payments.save(
      payments.create.year(
        year,
        userId,
        baseVals.payments.reduce((acc, p) => acc + p.amount, 0),
        `Vuosi ${year}`
      )
    );
  },
  async privMonthUpdate(
    userId: string,
    year: number,
    month: number,
    relPrices: Price[],
    curRegs: RealTMonth
  ) {
    const getPriceByFood = (
      food: Food,
      day: number,
      fod: "lunch" | "coffee" | "dinner"
    ): number => {
      const amounts = {
        normal:
          (food.normal || 0) +
          (food.special && food.special.length
            ? food.special.reduce(
                (acc, sf) => acc + (sf.base === "normal" ? sf.count : 0),
                0
              )
            : 0) +
          (food.specialIds && food.specialIds.length
            ? food.specialIds.reduce(
                (acc, sf) => acc + (sf.base === "normal" ? sf.count : 0),
                0
              )
            : 0),
        young:
          (food.young || 0) +
          (food.special && food.special.length
            ? food.special.reduce(
                (acc, sf) => acc + (sf.base === "young" ? sf.count : 0),
                0
              )
            : 0) +
          (food.specialIds && food.specialIds.length
            ? food.specialIds.reduce(
                (acc, sf) => acc + (sf.base === "young" ? sf.count : 0),
                0
              )
            : 0),
        child:
          (food.child || 0) +
          (food.special && food.special.length
            ? food.special.reduce(
                (acc, sf) => acc + (sf.base === "child" ? sf.count : 0),
                0
              )
            : 0) +
          (food.specialIds && food.specialIds.length
            ? food.specialIds.reduce(
                (acc, sf) => acc + (sf.base === "child" ? sf.count : 0),
                0
              )
            : 0),
      };
      const today = `${year}-${month + 1 < 10 ? `0${month + 1}` : month + 1}-${
        day < 10 ? `0${day}` : day
      }`;
      const rPrices = relPrices.filter(
        (p) => p.start <= today && p.end >= today && p.fod === fod
      );
      const rightPrice = rPrices.some((p) => p.special)
        ? rPrices.filter((p) => p.special)[0]
        : rPrices[0];
      if (rightPrice) {
        console.log(today, amounts, rightPrice);
        return (
          amounts.normal * rightPrice.normal +
          amounts.young * rightPrice.young +
          amounts.child * rightPrice.child
        );
      } else {
        console.log(`No price ${today}`, relPrices);
        return 0;
      }
    };
    const total = curRegs.days.reduce(
      (acc, d) =>
        acc +
        (d.lunch ? getPriceByFood(d.lunch, d.num, "lunch") : 0) +
        (d.coffee ? getPriceByFood(d.coffee, d.num, "coffee") : 0) +
        (d.dinner ? getPriceByFood(d.dinner, d.num, "dinner") : 0),
      0
    );
    return payments.save(
      payments.create.month(
        month,
        year,
        userId,
        -total,
        `${monthNames[month] || "Error"} ${year}`
      )
    );
  },
  async updateMonthByUserId(
    userId: string,
    year: number,
    month: number
  ): Promise<any> {
    const [curPrices, curRegs] = await Promise.all([
      price.getByYear(year),
      regs.getByUserIdAndYearAndMonth(userId, year, month),
    ]);
    const relPrices = curPrices.filter(
      (p) =>
        p.start < `${year}-${month + 2 < 10 ? `0${month + 2}` : month + 2}` &&
        p.end > `${year}-${month + 1 < 10 ? `0${month + 1}` : month + 1}`
    );
    await paymentUpdates.privMonthUpdate(
      userId,
      year,
      month,
      relPrices,
      curRegs
    );

    return paymentUpdates.updateYearByUserId(userId, year);
  },
  async updateMonthsByMonth(year: number, month: number) {
    const [curPrices, curRegs] = await Promise.all([
      price.getByYear(year),
      regs.getByYearAndMonth(year, month),
    ]);
    const relPrices = curPrices.filter(
      (p) =>
        p.start < `${year}-${month + 2 < 10 ? `0${month + 2}` : month + 2}` &&
        p.end > `${year}-${month + 1 < 10 ? `0${month + 1}` : month + 1}`
    );
    const relRegsObj = _.groupBy(curRegs, (dbu) => dbu.userId);
    const relRegs = Object.keys(relRegsObj).map((key): {
      userId: string;
      regs: RealTMonth;
    } => {
      const cur = relRegsObj[key];
      return {
        userId: cur[0].userId,
        regs: {
          year,
          month,
          ts: 0,
          days: cur.map((dbd) => ({
            num: dbd.day,
            lunch: dbd.lunch,
            coffee: dbd.coffee,
            dinner: dbd.dinner,
          })),
        },
      };
    });
    return Promise.all(
      relRegs.map(async (r) => {
        await paymentUpdates.privMonthUpdate(
          r.userId,
          year,
          month,
          relPrices,
          r.regs
        );
        return paymentUpdates.updateYearByUserId(r.userId, year);
      })
    );
  },
};

export const addUser: APIGatewayProxyHandler = async (event, _context) => {
  try {
    const name = event.body;

    await user.add(user.createNew(name));

    const res = await user.getAll();

    return success(res, event);
  } catch (e) {
    console.log(e);
    return fail(`Perhekunnan lisääminen epäonnistui`);
  }
};

export const addUserAllergy: APIGatewayProxyHandler = async (
  event,
  _context
) => {
  try {
    const body: WithUserId<AllergyProfile> = JSON.parse(event.body);
    const { userId, data } = body;

    if (userId.length === 0) {
      throw new Error("userId.length is 0");
    }

    await user.addAllergy(userId, user.checkProfile(data));

    const res = await user.getAll();

    return success(res, event);
  } catch (e) {
    console.log(e);
    return fail(`Allergian lisääminen epäonnistui`);
  }
};

export const getAllUsers: APIGatewayProxyHandler = async (event, _context) => {
  try {
    const res = await user.getAll();

    return success(res, event);
  } catch (e) {
    console.log(e);
    return fail(`Hakeminen epäonnistui`);
  }
};

export const getUserById: APIGatewayProxyHandler = async (event, _context) => {
  try {
    const id = event.pathParameters.id;

    const resp: RespIndUser = await user.getById(id);

    const res: IndUser = {
      id: resp.id,
      name: resp.name,
      archievedBalance: resp.archievedBalance,
      allergyProfiles: Object.keys(resp.profiles).map(
        (key) => resp.profiles[key]
      ),
    };

    return success(res, event);
  } catch (e) {
    console.log(e);
    return fail(`ID:llä haku epäonnistui`);
  }
};

export const addPrice: APIGatewayProxyHandler = async (event, _context) => {
  try {
    const body = JSON.parse(event.body);
    const {
      id,
      fod,
      start,
      end,
      normal,
      young,
      child,
      special,
      time,
      name,
    } = body;

    await price.add(
      price.dbPriceFromPrice(
        id
          ? body
          : price.createNew(
              fod,
              start,
              end,
              normal,
              young,
              child,
              special,
              time,
              name
            )
      )
    );

    await Promise.all(
      getMonthYearPairs(start, end).map((el) =>
        paymentUpdates.updateMonthsByMonth(el.year, el.month)
      )
    );

    const res = await price.getByYear(Number(start.split("-")[0]));

    return success(res, event);
  } catch (e) {
    console.log(e);
    return fail(`Perhekunnan lisääminen epäonnistui`);
  }
};

export const getPricesByYear: APIGatewayProxyHandler = async (
  event,
  _context
) => {
  try {
    const year = Number(event.pathParameters.year);

    const res = await price.getByYear(year);

    return success(res, event);
  } catch (e) {
    console.log(e);
    return fail(`ID:llä haku epäonnistui`);
  }
};

export const getMonthByUserId: APIGatewayProxyHandler = async (
  event,
  _context
) => {
  try {
    const body: WithUserId<{ month: number; year: number }> = JSON.parse(
      event.body
    );
    const userId = body.userId;
    const { year, month } = body.data;

    const res = await regs.getByUserIdAndYearAndMonth(userId, year, month);

    return success(res, event);
  } catch (e) {
    console.log(e);
    return fail(`Tapahtumien haku epäonnistui`);
  }
};

export const getKitchenDay: APIGatewayProxyHandler = async (
  event,
  _context
) => {
  try {
    const {
      year,
      month,
      day,
    }: { year: number; month: number; day: number } = JSON.parse(event.body);

    const res = await regs.getAllByDay(year, month, day);

    return success(res, event);
  } catch (e) {
    console.log(e);
    return fail(`Tapahtumien haku epäonnistui`);
  }
};

export const saveDay: APIGatewayProxyHandler = async (event, _context) => {
  try {
    const body: WithUserId<Day> & { month: number; year: number } = JSON.parse(
      event.body
    );
    const { userId, data, month, year } = body;

    if (userId.length === 0) {
      throw new Error("userId.length is 0");
    }

    await regs.save(regs.createFromDay(data, userId, year, month));

    await paymentUpdates.updateMonthByUserId(userId, year, month);

    const res = await regs.getByUserIdAndYearAndMonth(userId, year, month);

    return success(res, event);
  } catch (e) {
    console.log(e);
    return fail(`Ilmon lisääminen epäonnistui`);
  }
};

export const getPaymentsByYear: APIGatewayProxyHandler = async (
  event,
  _context
) => {
  try {
    const body: WithUserId<number> = JSON.parse(event.body);
    const { userId, data } = body;

    if (userId.length === 0) {
      throw new Error("userId.length is 0");
    }

    const res = await payments.getPaymentsOfYear(userId, data);

    return success(res, event);
  } catch (e) {
    console.log(e);
    return fail(`Ilmon lisääminen epäonnistui`);
  }
};

export const savePayment: APIGatewayProxyHandler = async (event, _context) => {
  try {
    const body: WithUserId<{
      dateDay: DateDay;
      amount: number;
      name: string;
      id?: string;
    }> = JSON.parse(event.body);
    const { userId, data } = body;
    const { dateDay, amount, name, id } = data;

    if (userId.length === 0) {
      throw new Error("userId.length is 0");
    }

    await payments.save(payments.create.ind(dateDay, userId, amount, name, id));

    const res = await payments.getPaymentsOfYear(userId, dateDay.year);

    return success(res, event);
  } catch (e) {
    console.log(e);
    return fail(`Ilmon lisääminen epäonnistui`);
  }
};
