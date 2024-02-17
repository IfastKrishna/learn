import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { User } from "../models/user.models.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import Jwt from "jsonwebtoken";
import mongoose from "mongoose";

const generateAccessTokenAndRefereshTokens = async (userId) => {
  try {
    const user = await User.findById(userId);
    const accessToken = await user.generateAccessToken();
    const refreshToken = await user.generateRefreshToken();
    user.refreshToken = refreshToken;
    await user.save({ validateBeforeSave: false });
    return { accessToken, refreshToken };
  } catch (error) {
    throw ApiError(
      500,
      "Something went wrong while generating access token and referesh token"
    );
  }
};

const registerUser = asyncHandler(async (req, res) => {
  // 1 get user data from frontend
  // 2 check valid user data
  // 3 check user allready exits in database emai or username
  // 4 check user avtar (images)
  // 5 uplde them to cloudinary avtar
  // 6 create user object  create entry in db
  // 7 remove password and refresh token from response
  // 8 check for user creation
  // 9 if user is created successfully so retun user response
  // 10 if faild so retrun erro response

  // 1 get user data from frontend
  const { username, email, password, fullName } = req.body;

  // Check for empty fields
  if (
    [username, email, password, fullName].some((field) => field?.trim() === "")
  ) {
    throw new ApiError(400, "Please fill all the required fields");
  }

  // check user exists already
  const existedUser = await User.findOne({ $or: [{ username }, { email }] });
  if (existedUser) {
    throw new ApiError(409, "User already exists");
  }

  // check avatar is available
  const avatarLocalPath = req.files?.avatar[0]?.path;
  let coverImageLocalPath;
  if (
    req.files &&
    req.files.coverImage &&
    Array.isArray(req.files.coverImage.files) &&
    req.files.coverImage.files.length > 0
  ) {
    coverImageLocalPath = req.files.coverImage[0].path;
  }

  if (!avatarLocalPath) {
    throw new ApiError(400, "avatar file is required");
  }

  // Upload avatar to cloudinary
  const avatar = await uploadOnCloudinary(avatarLocalPath);
  let coverImage = await uploadOnCloudinary(coverImageLocalPath);

  // if Uploading is failed
  if (!avatar) {
    throw new ApiError(`Uploading avatar failed please try again`);
  }

  // Create user in the database
  const user = await User.create({
    fullName,
    username: username.toLowerCase(),
    email: email.toLowerCase(),
    password,
    avatar: avatar.url,
    coverImage: coverImage?.url || "",
  });

  // verify use was created and  Retrieve user without sensitive information
  const createdUser = await User.findById(user._id).select(
    "-password -refreshToken"
  );

  // if user not created then throw error
  if (!createdUser) {
    throw new ApiError(500, "Something went wrong whie registering the user");
  }

  // return success response
  res
    .status(201)
    .json(new ApiResponse(200, createdUser, "User register successfully"));
});

const loginUser = asyncHandler(async (req, res) => {
  // getUser from email or username and passwords
  // verify that user is registered and match id and password
  // if not registered  so give error message your account not registered
  // if password is wrong so give error message your password is wrong
  // gerate toke and refresh token
  // sed token in cookie
  // and send send user login true

  const { username, email, password } = req.body;

  if (!(email || username)) {
    throw new ApiError(400, "Username or email is required");
  }

  const user = await User.findOne({ $or: [{ username }, { email }] });
  // console.log("USER :: WHEN I SEARCH :: ", user);
  if (!user) {
    throw new ApiError(404, "User dose not registered");
  }

  const isPasswordValid = await user.isPasswordCorrect(password);
  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid user credentails");
  }

  const { accessToken, refreshToken } =
    await generateAccessTokenAndRefereshTokens(user._id);

  // const loggedInUser = {...user, accessToken}; // update and send user
  console.log("USER ID :: ", user._id);
  const loggedInUser = await User.findById(user._id).select(
    "-password -refreshToken"
  );
  //if this is expesive

  const options = {
    httpOnly: true,
    secure: true,
  }; // if httpOnly true and secure true so from fronted only see don't modifyable

  return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
      new ApiResponse(
        200,
        { user: loggedInUser, accessToken, refreshToken },
        "User logged In Scuccessfuly"
      )
    );
});

const logoutUser = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(
    req.user._id,
    {
      $set: { refreshToken: undefined },
    },
    {
      new: true,
    }
  );

  const options = {
    httpOnly: true,
    secure: true,
  };

  return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(new ApiResponse(200, {}, "User logged Out"));
});

// const refereshAccessToken = asyncHandler(async (req, res) => {
//   const token = req.cookies?.refreshToken || req.body.refreshToken;
//   // req.header("Authorization")?.replace("Bearer ", "");

//   if (!token) {
//     throw new ApiError(401, "Unauthorized request");
//   }

//   const decodedToken = Jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
//   const { accessToken, refreshToken } =
//     await generateAccessTokenAndRefereshTokens(decodedToken?._id);

//   const loggedInUser = await User.findByIdAndUpdate(
//     decodedToken?._id,
//     {
//       $set: { refreshToken: refreshToken },
//     },
//     {
//       new: true,
//     }
//   ).select("-password -refreshToken");
//   if (!loggedInUser) {
//     throw new ApiError(401, "Invalid Refresh Token");
//   }

//   const options = {
//     httpOnly: true,
//     secure: true,
//   };

//   return res
//     .status(200)
//     .cookie("accessToken", accessToken, options)
//     .cookie("refreshToken", refreshToken, options)
//     .json(
//       new ApiResponse(
//         200,
//         { user: loggedInUser, accessToken, refreshToken },
//         "User logged In Scuccessfuly"
//       )
//     );
// }); made by me

const refereshAccessToken = asyncHandler(async (req, res) => {
  try {
    const inComingRefreshToken =
      req.cookies?.refreshToken || req.body.refreshToken;
    // req.header("Authorization")?.replace("Bearer ", "");

    if (!inComingRefreshToken) {
      throw new ApiError(401, "Unauthorized request");
    }

    const decodedToken = Jwt.verify(
      inComingRefreshToken,
      process.env.REFRESH_TOKEN_SECRET
    );

    const user = await User.findById(decodedToken?._id);

    if (!user) {
      throw new ApiError(401, "Invalid Refresh Token");
    }

    if (inComingRefreshToken !== user?.refreshToken) {
      throw new ApiError(401, "Refresh Token is expired or used");
    }

    const { accessToken, refreshToken } =
      await generateAccessTokenAndRefereshTokens();

    const options = {
      httpOnly: true,
      secure: true,
    };

    return res
      .status(200)
      .cookie("accessToken", accessToken, options)
      .cookie("refreshToken", refreshToken, options)
      .json(
        new ApiResponse(
          200,
          { accessToken, refreshToken },
          "Access token refesh Scuccessfuly"
        )
      );
  } catch (error) {
    throw new ApiError(
      500,
      error?.message || "Something went wront while refreshing Access token"
    );
  }
});

const changeCurrectPassword = asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const user = await User.findById(req.user?._id);
  const validPassword = await user.isPasswordCorrect(oldPassword);
  if (!validPassword) {
    throw new ApiError(400, "Invalid Old Password");
  }
  user.password = newPassword;
  await user.save({ validateBeforeSave: false });
  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Password updated successfully"));
});

const getCurrentUser = asyncHandler(async (req, res) => {
  const user = req.user?.user;
  if (!user) {
    throw new ApiError(400, "Somthing went wront while getting current user");
  }
  res
    .status(200)
    .json(new ApiResponse(200, user, "Current user fetched successfully"));
});

const updateAccountDetails = asyncHandler(async (req, res) => {
  const { email, fullName } = req.body;
  if (!email || !fullName) {
    throw new ApiError(400, "Email or Full Name is required");
  }

  const user = await User.findByIdAndUpdate(
    req.user?._id,
    { $set: { email, fullName } },
    { new: true }
  ).select("-password");

  return res
    .status(200)
    .json(new ApiResponse(200, user, "Account details updated successfully"));
});

const updateUserAvatar = asyncHandler(async (req, res) => {
  const avatarLocalPath = req.file?.path;
  if (!avatarLocalPath) {
    throw new ApiError(400, "Avatar file is missing");
  }

  const avatar = await uploadOnCloudinary(avatarLocalPath);

  if (!avatar) {
    throw new ApiError(500, "Error while uploading avatar on cloudinary");
  }

  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: { avatar: avatar.url },
    },
    { new: true }
  ).select("-password");

  return res
    .status(200)
    .json(new ApiResponse(200, user, "Avatar Updated successfully"));
});

const updateUserCoverImage = asyncHandler(async (req, res) => {
  const coverImageLocalPath = req.file?.path;
  if (!coverImageLocalPath) {
    throw new ApiError(400, "CoverImage file is missing");
  }

  const coverImage = await uploadOnCloudinary(avatarLocalPath);

  if (!coverImage) {
    throw new ApiError(500, "Error while uploading coverImage on cloudinary");
  }

  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: { coverImage: coverImage.url },
    },
    { new: true }
  ).select("-password");

  return res
    .status(200)
    .json(new ApiResponse(200, user, "CoverImage updated successfully"));
});

const getUserChannelProfile = asyncHandler(async (req, res) => {
  const { username } = req.params;
  if (!username?.trim()) {
    throw new ApiError(400, "username is missing");
  }

  const channel = await User.aggregate([
    {
      $match: {
        username: username?.toLowerCase(),
      },
    },
    {
      $lookup: {
        from: "subscriptions",
        localField: _id,
        foreignField: "channel",
        as: "subscribers",
      },
    },
    {
      $lookup: {
        from: "subscriptions",
        localField: "_id",
        foreignField: "subscriber",
        as: "subscribed",
      },
    },
    {
      $addFields: {
        subscribersCount: {
          $size: "$subscribers",
        },
        subscribedToCount: {
          $size: "$subscribed",
        },
        isSubscribed: {
          $cond: {
            if: {
              $in: [req.user?._id, "$subscribers.subscriber"],
            },
            then: true,
            else: false,
          },
        },
      },
    },
    {
      $project: {
        fullName: 1,
        username: 1,
        subscribersCount: 1,
        subscribedToCount: 1,
        isSubscribed: 1,
        avatar: 1,
        coverImage: 1,
        email: 1,
      },
    },
  ]);

  console.log(channel);

  if (!channel?.length) {
    throw ApiError(404, "channel dose not exists");
  }

  res
    .status(200)
    .json(
      new ApiResponse(200, channel[0], "User channel fetched successfully")
    );
});

const getWatchHistory = asyncHandler(async (req, res) => {
  const user = await User.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(req.user?._id),
      },
    },
    {
      $lookup: {
        from: "videos",
        localField: "watchHistory",
        foreignField: "_id",
        as: "watchHistoy",
        pipeline: [
          {
            $lookup: {
              from: "users",
              localField: "owner",
              foreignField: "_id",
              as: "owner",
              pipeline: [
                {
                  $project: {
                    fullName: 1,
                    username: 1,
                    avatar: 1,
                  },
                },
              ],
            },
          },
          {
            $addFields: {
              owner: {
                $first: "$owner",
              },
            },
          },
        ],
      },
    },
  ]);

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        user[0].watchHistory,
        "User history fetched successfully"
      )
    );
});

export {
  registerUser,
  loginUser,
  logoutUser,
  refereshAccessToken,
  getCurrentUser,
  changeCurrectPassword,
  updateAccountDetails,
  updateUserAvatar,
  updateUserCoverImage,
  getUserChannelProfile,
  getWatchHistory,
};
